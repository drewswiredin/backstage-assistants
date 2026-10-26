#!/usr/bin/env node
/*
 * Fake Kubernetes API for LOCAL TESTING of the Kubernetes plugin's drawers
 * beside the assistants panel, without a cluster.
 *
 * Serves one Deployment, its ReplicaSet, and two running pods, all labelled
 * `backstage.io/kubernetes-id: example-website`; every other list is empty.
 * Clicking a pod on the entity's Kubernetes tab opens the plugin's PodDrawer
 * (a right-anchored MUI Drawer).
 *
 * Pure Node, zero dependencies. Wire it up with (app-config.local.yaml):
 *
 *   kubernetes:
 *     serviceLocatorMethod: { type: multiTenant }
 *     clusterLocatorMethods:
 *       - type: config
 *         clusters:
 *           - name: fake-cluster
 *             url: http://localhost:7011
 *             authProvider: serviceAccount
 *             serviceAccountToken: fake
 *             skipMetricsLookup: true
 *
 * and annotate the entity with `backstage.io/kubernetes-id: example-website`.
 *
 * Env knobs:
 *   FAKE_K8S_PORT  listen port (default 7011)
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_K8S_PORT ?? 7011);
const ID = 'example-website';
const NAMESPACE = 'demo';
const started = new Date(Date.now() - 31 * 60_000).toISOString();
const labels = { 'backstage.io/kubernetes-id': ID, app: ID };

const meta = (name, extra = {}) => ({
  name,
  namespace: NAMESPACE,
  uid: `uid-${name}`,
  labels,
  creationTimestamp: started,
  ...extra,
});

const deployment = {
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: meta(`${ID}-deployment`),
  spec: {
    replicas: 2,
    selector: { matchLabels: labels },
    template: { metadata: { labels } },
  },
  status: { replicas: 2, readyReplicas: 2, availableReplicas: 2 },
};

const replicaSet = {
  apiVersion: 'apps/v1',
  kind: 'ReplicaSet',
  metadata: meta(`${ID}-deployment-584c7c6894`, {
    ownerReferences: [
      {
        kind: 'Deployment',
        name: deployment.metadata.name,
        uid: deployment.metadata.uid,
      },
    ],
  }),
  spec: { replicas: 2, selector: { matchLabels: labels } },
  status: { replicas: 2, readyReplicas: 2 },
};

const container = (name, image, cpu, memory) => ({
  name,
  image,
  resources: {
    requests: { cpu, memory },
    limits: { cpu: '250m', memory: '3328Mi' },
  },
});

const pod = suffix => ({
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: meta(`${replicaSet.metadata.name}-${suffix}`, {
    ownerReferences: [
      {
        kind: 'ReplicaSet',
        name: replicaSet.metadata.name,
        uid: replicaSet.metadata.uid,
      },
    ],
  }),
  spec: {
    containers: [
      container('web', 'example.registry/web:sha-4337981', '500m', '1536Mi'),
      container('proxy', 'example.registry/proxy:1.21.1', '50m', '128Mi'),
    ],
  },
  status: {
    phase: 'Running',
    podIP: '10.0.16.205',
    startTime: started,
    conditions: [
      { type: 'Initialized', status: 'True' },
      { type: 'Ready', status: 'True' },
      { type: 'ContainersReady', status: 'True' },
      { type: 'PodScheduled', status: 'True' },
    ],
    containerStatuses: ['web', 'proxy'].map(name => ({
      name,
      ready: true,
      started: true,
      restartCount: 0,
      image: name,
      imageID: name,
      state: { running: { startedAt: started } },
    })),
  },
});

const byPlural = {
  deployments: [deployment],
  replicasets: [replicaSet],
  pods: [pod('l4ntz'), pod('x6g4p')],
};

createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const plural = pathname.split('/').filter(Boolean).pop();
  const items = byPlural[plural] ?? [];
  console.error(`${req.method} ${req.url} -> ${items.length} items`);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({ apiVersion: 'v1', kind: 'List', metadata: {}, items }),
  );
}).listen(PORT, () => {
  console.error(`fake Kubernetes API on http://localhost:${PORT}`);
});
