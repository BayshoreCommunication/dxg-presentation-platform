// Pmp-dev-Bootstrap — the ONLY stack during the development phase (D-008).
// One t4g.medium EC2 (docker compose runs the whole platform) + one versioned
// S3 bucket + budget alarms. Deliberately: no ALB, no NAT, no CloudFront, no
// RDS/ElastiCache — see docs/infra/DEV_BOOTSTRAP.md for what is deferred and why.
// Isolation rules: own tiny VPC (never RFPilot's), pmp-* names, product=pmp tags.
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as budgets from 'aws-cdk-lib/aws-budgets';

export interface DevBootstrapStackProps extends cdk.StackProps {
  alertEmail: string;
}

export class DevBootstrapStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DevBootstrapStackProps) {
    super(scope, id, props);

    // Own minimal VPC: 1 AZ, public subnet only (no NAT = no NAT cost).
    const vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: 'pmp-dev',
      availabilityZones: ['us-east-2a'], // pinned: no lookup, deterministic synth

      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC }],
    });

    // Storage: one versioned bucket; prefixes stand in for the pilot six-bucket layout.
    const bucket = new s3.Bucket(this, 'Storage', {
      bucketName: `pmp-dev-storage-${this.account}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [
        { id: 'abort-incomplete-multipart', abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) },
        { id: 'expire-backups', prefix: 'backups/', expiration: cdk.Duration.days(14) },
        {
          id: 'trim-noncurrent-derivatives',
          prefix: 'derivatives/',
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN, // stateful: never auto-deleted
    });

    const sg = new ec2.SecurityGroup(this, 'ServerSg', {
      vpc,
      securityGroupName: 'pmp-dev-server',
      description: 'pmp dev server: web in, all out',
      allowAllOutbound: true,
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'http (caddy acme + redirect)');
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'https');
    // No SSH ingress: access via SSM Session Manager only (DEV_BOOTSTRAP §3).

    const role = new iam.Role(this, 'ServerRole', {
      roleName: 'pmp-dev-server',
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });
    bucket.grantReadWrite(role); // scoped to the pmp bucket only — nothing RFPilot

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'dnf install -y docker git',
      'systemctl enable --now docker',
      'usermod -aG docker ec2-user',
      // docker compose v2 plugin (arm64)
      'mkdir -p /usr/local/lib/docker/cli-plugins',
      'curl -fsSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64 -o /usr/local/lib/docker/cli-plugins/docker-compose',
      'chmod +x /usr/local/lib/docker/cli-plugins/docker-compose',
      'mkdir -p /opt/pmp && chown ec2-user:ec2-user /opt/pmp',
      // app checkout + compose up happens via SSM/manual step (repo is private; no deploy key baked into user data)
    );

    const instance = new ec2.Instance(this, 'Server', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceName: 'pmp-dev-server',
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(50, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: false, // data lives here (postgres volume) until pilot infra exists
          }),
        },
      ],
      securityGroup: sg,
      role,
      userData,
      requireImdsv2: true,
    });

    const eip = new ec2.CfnEIP(this, 'Eip', {
      domain: 'vpc',
      instanceId: instance.instanceId,
      tags: [{ key: 'Name', value: 'pmp-dev-server' }],
    });

    // Budget guardrail (D-008): $100 cap on product=pmp spend, warn at 80%.
    // NOTE: activate `product` as a cost-allocation tag in Billing once (manual, account-level).
    new budgets.CfnBudget(this, 'Budget', {
      budget: {
        budgetName: 'pmp-dev-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: 100, unit: 'USD' },
        costFilters: { TagKeyValue: ['user:product$pmp'] },
      },
      notificationsWithSubscribers: [
        {
          notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 80 },
          subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }],
        },
        {
          notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 100 },
          subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }],
        },
      ],
    });

    new cdk.CfnOutput(this, 'InstanceId', { value: instance.instanceId });
    new cdk.CfnOutput(this, 'PublicIp', { value: eip.attrPublicIp });
    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'SsmSession', {
      value: `aws ssm start-session --target ${instance.instanceId} --region ${this.region}`,
    });
  }
}
