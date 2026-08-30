#!/usr/bin/env node
// Pmp CDK app. Dev phase (D-008): ONE stack only — Pmp-dev-Bootstrap.
// The pilot/production stack set (docs/infra/ENVIRONMENTS.md) is added at pilot prep.
import * as cdk from 'aws-cdk-lib';
import { DevBootstrapStack } from '../lib/dev-bootstrap-stack';

const app = new cdk.App();

new DevBootstrapStack(app, 'Pmp-dev-Bootstrap', {
  env: {
    account: '295229565954', // RFPilot account, fixed by D-008 — deploy with the `rfpilot` CLI profile
    region: 'us-east-2',
  },
  alertEmail: app.node.tryGetContext('pmpAlertEmail') ?? 'travis@swopme.co',
  description: 'DXG Presentation Platform dev bootstrap: single EC2 + S3 (docs/infra/DEV_BOOTSTRAP.md)',
});

// Cost separation from RFPilot (mandatory — D-008/DEV_BOOTSTRAP §2).
cdk.Tags.of(app).add('product', 'pmp');
cdk.Tags.of(app).add('env', 'dev');
cdk.Tags.of(app).add('owner', 'travis');
cdk.Tags.of(app).add('costcenter', 'pmp-dev');
