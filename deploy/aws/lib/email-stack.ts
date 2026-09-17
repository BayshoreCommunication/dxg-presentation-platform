import * as cdk from "aws-cdk-lib";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sns from "aws-cdk-lib/aws-sns";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

export type EmailStackProps = cdk.StackProps & {
  /** Already-verified sending domain. Verification is a DNS act, not a stack act. */
  readonly sendingDomain: string;
  /** Prefix so nothing collides with RFPilot in the shared account (D-006/D-008). */
  readonly namePrefix?: string;
};

/**
 * Email infrastructure for the platform: a configuration set and the SNS topic
 * its delivery events publish to.
 *
 * The sending identity is intentionally NOT created here. `dxg-agency.com` is
 * already verified in the account, and a CDK-managed identity would try to own
 * DNS records the client controls. Its custom MAIL FROM domain
 * (`mail.dxg-agency.com`) is set on that identity for the same reason — it is an
 * identity attribute, and adopting the identity to manage it would put CDK in
 * charge of DNS it cannot reach. See `docs/infra/EMAIL.md`.
 *
 * The configuration set is the piece that matters: **without one, SES publishes
 * no delivery, bounce or complaint events at all**, and the platform would
 * believe every message landed.
 */
export class EmailStack extends cdk.Stack {
  readonly configurationSetName: string;
  readonly eventTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: EmailStackProps) {
    super(scope, id, props);
    const prefix = props.namePrefix ?? "pmp";

    this.eventTopic = new sns.Topic(this, "EmailEvents", {
      topicName: `${prefix}-email-events`,
      displayName: "DXG PM email delivery events",
    });

    // Only SES, and only this account, may publish here.
    this.eventTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowSesPublish",
        principals: [new iam.ServicePrincipal("ses.amazonaws.com")],
        actions: ["sns:Publish"],
        resources: [this.eventTopic.topicArn],
        conditions: { StringEquals: { "AWS:SourceAccount": cdk.Stack.of(this).account } },
      }),
    );

    const configurationSet = new ses.CfnConfigurationSet(this, "ConfigurationSet", {
      name: `${prefix}-email`,
      // Speaker names, talk titles and one-time links travel in these messages.
      deliveryOptions: { tlsPolicy: "REQUIRE" },
      reputationOptions: { reputationMetricsEnabled: true },
      sendingOptions: { sendingEnabled: true },
      // A hard bounce or a complaint stops us mailing that address again.
      suppressionOptions: { suppressedReasons: ["BOUNCE", "COMPLAINT"] },
    });
    this.configurationSetName = `${prefix}-email`;

    // Open and click tracking are deliberately absent: SES rewrites every link
    // through awstrack.me unless a custom tracking domain exists, and a speaker
    // being asked to click an unfamiliar redirect is worse than the metric is
    // worth. Add TrackingOptions once a subdomain is available.
    const events = new ses.CfnConfigurationSetEventDestination(this, "SnsEvents", {
      configurationSetName: configurationSet.name!,
      eventDestination: {
        name: "sns-events",
        enabled: true,
        matchingEventTypes: [
          "SEND",
          "DELIVERY",
          "BOUNCE",
          "COMPLAINT",
          "REJECT",
          "RENDERING_FAILURE",
          "DELIVERY_DELAY",
        ],
        snsDestination: { topicArn: this.eventTopic.topicArn },
      },
    });
    events.node.addDependency(configurationSet);

    new cdk.CfnOutput(this, "SendingDomain", { value: props.sendingDomain });
    new cdk.CfnOutput(this, "ConfigurationSetName", { value: this.configurationSetName });
    new cdk.CfnOutput(this, "EventTopicArn", { value: this.eventTopic.topicArn });
  }
}
