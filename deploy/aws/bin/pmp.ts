#!/usr/bin/env node
// Pmp CDK app. Dev phase (D-008): ONE stack only — Pmp-dev-Bootstrap.
// The pilot/production stack set (docs/infra/ENVIRONMENTS.md) is added at pilot prep.
import * as cdk from 'aws-cdk-lib';
import { DevBootstrapStack } from '../lib/dev-bootstrap-stack';
import { EmailStack } from '../lib/email-stack';

const app = new cdk.App();

new DevBootstrapStack(app, 'Pmp-dev-Bootstrap', {
  env: {
    account: '295229565954', // RFPilot account, fixed by D-008 — deploy with the `rfpilot` CLI profile
    region: 'us-east-2',
  },
  alertEmail: app.node.tryGetContext('pmpAlertEmail') ?? 'travis@swopme.co',
  description: 'DXG Presentation Platform dev bootstrap: single EC2 + S3 (docs/infra/DEV_BOOTSTRAP.md)',
});

// Email: configuration set + delivery-event topic (D-018).
// NOTE: the live dev-account resources were created with the CLI on 2026-09-17
// and are NOT yet under CloudFormation. Adopt them with `cdk import` before the
// first deploy of this stack, or delete them and let CDK create them — deploying
// as-is will fail on the existing names. See docs/infra/EMAIL.md.
new EmailStack(app, 'Pmp-Email', {
  env: {
    account: '295229565954',
    region: 'us-east-2',
  },
  sendingDomain: 'av-rfpilot.com',
  description: 'DXG Presentation Platform email: SES configuration set + delivery event topic',
});

// Cost separation from RFPilot (mandatory — D-008/DEV_BOOTSTRAP §2).
cdk.Tags.of(app).add('product', 'pmp');
cdk.Tags.of(app).add('env', 'dev');
cdk.Tags.of(app).add('owner', 'travis');
cdk.Tags.of(app).add('costcenter', 'pmp-dev');
