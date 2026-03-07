import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

process.env.NODE_ENV = 'test';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const prismaDir = path.resolve(repoRoot, 'prisma');
const testDb = path.join(prismaDir, 'test.db');

if (fs.existsSync(testDb)) {
  fs.rmSync(testDb);
}

process.env.DATABASE_URL = 'file:./test.db';
execSync('npx prisma db push --skip-generate', {
  cwd: repoRoot,
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  stdio: 'pipe',
});

const { app, prisma, stopTrafficLoop } = await import('../server.ts');

test.beforeEach(async () => {
  await prisma.subscriberSession.deleteMany();
  await prisma.ipAddress.deleteMany();
  await prisma.interface.deleteMany();
  await prisma.ipPool.deleteMany();
  await prisma.vrf.deleteMany();
  await prisma.link.deleteMany();
  await prisma.port.deleteMany();
  await prisma.device.deleteMany();
  await prisma.network.deleteMany();
});

test.after(async () => {
  stopTrafficLoop();
  await prisma.$disconnect();
  if (fs.existsSync(testDb)) {
    fs.rmSync(testDb);
  }
});

test('API smoke: create devices, enforce strict link rules, fetch topology', async () => {
  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-1',
    type: 'OLT',
    x: 100,
    y: 100,
  });
  assert.equal(oltRes.status, 201);

  const splitterRes = await request(app).post('/api/devices').send({
    name: 'SPLITTER-1',
    type: 'SPLITTER',
    x: 180,
    y: 130,
  });
  assert.equal(splitterRes.status, 201);

  const onuRes = await request(app).post('/api/devices').send({
    name: 'ONT-1',
    type: 'ONT',
    x: 250,
    y: 150,
  });
  assert.equal(onuRes.status, 201);

  const oltPonPort = oltRes.body.ports.find((port: any) => port.portType === 'PON');
  const splitterIn = splitterRes.body.ports.find((port: any) => port.portType === 'IN');
  const splitterOut = splitterRes.body.ports.find((port: any) => port.portType === 'OUT');
  const onuPonPort = onuRes.body.ports.find((port: any) => port.portType === 'PON');

  assert.ok(oltPonPort?.id);
  assert.ok(splitterIn?.id);
  assert.ok(splitterOut?.id);
  assert.ok(onuPonPort?.id);

  const directInvalidRes = await request(app).post('/api/links').send({
    a_interface_id: oltPonPort.id,
    b_interface_id: onuPonPort.id,
  });
  assert.equal(directInvalidRes.status, 400);

  const feederRes = await request(app).post('/api/links').send({
    a_interface_id: oltPonPort.id,
    b_interface_id: splitterIn.id,
    length_km: 2.5,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(feederRes.status, 201);
  assert.equal(feederRes.body.length_km, 2.5);
  assert.equal(feederRes.body.physical_medium_id, 'G.652.D');

  const accessRes = await request(app).post('/api/links').send({
    a_interface_id: splitterOut.id,
    b_interface_id: onuPonPort.id,
  });
  assert.equal(accessRes.status, 201);

  const topologyRes = await request(app).get('/api/topology');
  assert.equal(topologyRes.status, 200);
  assert.equal(topologyRes.body.nodes.length, 4);
  assert.equal(topologyRes.body.edges.length, 2);
});

test('API smoke: new endpoints exist and return expected baseline shape', async () => {
  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-A',
    type: 'OLT',
    x: 10,
    y: 10,
  });
  assert.equal(oltRes.status, 201);
  const oltId = oltRes.body.id as string;
  const oltPonPort = oltRes.body.ports.find((port: any) => port.portType === 'PON');
  assert.ok(oltPonPort?.id);

  const provisionRes = await request(app).post(`/api/devices/${oltId}/provision`).send({});
  assert.equal(provisionRes.status, 200);

  const mgmtInterface = await prisma.interface.findUnique({
    where: {
      deviceId_name: {
        deviceId: oltId,
        name: 'mgmt0',
      },
    },
  });
  assert.ok(mgmtInterface);
  assert.equal(mgmtInterface.role, 'MGMT');
  assert.equal(mgmtInterface.status, 'UP');
  assert.match(mgmtInterface.macAddress, /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);

  const mgmtAddresses = await prisma.ipAddress.findMany({
    where: {
      interfaceId: mgmtInterface.id,
    },
  });
  assert.equal(mgmtAddresses.length, 1);
  assert.equal(mgmtAddresses[0].isPrimary, true);
  assert.equal(mgmtAddresses[0].vrf, 'mgmt_vrf');
  assert.equal(mgmtAddresses[0].prefixLen, 24);
  assert.match(mgmtAddresses[0].ip, /^10\.250\.4\.\d+$/);

  const repeatedProvisionRes = await request(app).post(`/api/devices/${oltId}/provision`).send({});
  assert.equal(repeatedProvisionRes.status, 409);
  assert.equal(repeatedProvisionRes.body.error.code, 'ALREADY_PROVISIONED');

  const mgmtInterfaces = await prisma.interface.findMany({
    where: {
      deviceId: oltId,
      name: 'mgmt0',
    },
  });
  assert.equal(mgmtInterfaces.length, 1);

  const leakedAddresses = await prisma.ipAddress.findMany({
    where: {
      interfaceId: mgmtInterface.id,
    },
  });
  assert.equal(leakedAddresses.length, 1);

  const overrideRes = await request(app).patch(`/api/devices/${oltId}/override`).send({ admin_override_status: 'DEGRADED' });
  assert.equal(overrideRes.status, 200);

  const interfacesRes = await request(app).get(`/api/interfaces/${oltId}`);
  assert.equal(interfacesRes.status, 200);
  assert.ok(Array.isArray(interfacesRes.body));

  const summaryBulkRes = await request(app).get(`/api/ports/summary?ids=${oltId}`);
  assert.equal(summaryBulkRes.status, 200);
  assert.ok(Array.isArray(summaryBulkRes.body.items));
  assert.ok(summaryBulkRes.body.by_device_id);
  assert.ok(summaryBulkRes.body.by_device_id[oltId]);

  const summaryBulkRepeatedRes = await request(app).get('/api/ports/summary').query({ ids: [oltId, oltId] });
  assert.equal(summaryBulkRepeatedRes.status, 200);
  assert.ok(summaryBulkRepeatedRes.body.by_device_id[oltId]);

  const ontListRes = await request(app).get(`/api/ports/ont-list/${oltId}`);
  assert.equal(ontListRes.status, 200);
  assert.ok(Array.isArray(ontListRes.body.items));

  const fiberTypesRes = await request(app).get('/api/optical/fiber-types');
  assert.equal(fiberTypesRes.status, 200);
  assert.ok(Array.isArray(fiberTypesRes.body.items));
  assert.ok(fiberTypesRes.body.items.some((item: any) => item.name === 'G.652.D'));

  const catalogRes = await request(app).get('/api/catalog/hardware?type=OLT');
  assert.equal(catalogRes.status, 200);
  assert.ok(Array.isArray(catalogRes.body.items));
  assert.ok(catalogRes.body.items.length >= 1);
  assert.equal(catalogRes.body.items[0].device_type, 'OLT');

  const tariffsRes = await request(app).get('/api/catalog/tariffs');
  assert.equal(tariffsRes.status, 200);
  assert.ok(Array.isArray(tariffsRes.body.items));
  assert.ok(tariffsRes.body.items.some((item: any) => item.id === 'dg_private_100'));

  const simStatusRes = await request(app).get('/api/sim/status');
  assert.equal(simStatusRes.status, 200);
  assert.equal(typeof simStatusRes.body.interval_ms, 'number');

  const ipamPrefixesRes = await request(app).get('/api/ipam/prefixes');
  assert.equal(ipamPrefixesRes.status, 200);
  assert.ok(Array.isArray(ipamPrefixesRes.body.items));

  const ipamPoolsRes = await request(app).get('/api/ipam/pools');
  assert.equal(ipamPoolsRes.status, 200);
  assert.ok(Array.isArray(ipamPoolsRes.body.items));

  const batchHealthRes = await request(app).get('/api/batch/health');
  assert.equal(batchHealthRes.status, 200);
  assert.equal(batchHealthRes.body.status, 'ok');

  const batchCreateRes = await request(app).post('/api/links/batch').send({
    links: [{ a_interface_id: oltPonPort.id, b_interface_id: oltPonPort.id }],
    dry_run: true,
    request_id: 'smoke-batch',
  });
  assert.equal(batchCreateRes.status, 200);
  assert.equal(batchCreateRes.body.total_requested, 1);
});

test('API contract: canonical error envelope and backbone singleton guard', async () => {
  const reqId = 'req-audit-001';
  const first = await request(app)
    .post('/api/devices')
    .set('x-request-id', reqId)
    .send({
      name: 'Backbone-1',
      type: 'BACKBONE_GATEWAY',
      x: 0,
      y: 0,
    });
  assert.equal(first.status, 409);
  assert.equal(first.body.error.code, 'ALREADY_EXISTS');
  assert.equal(first.body.request_id, reqId);

  const notFound = await request(app)
    .get('/api/devices/non-existent')
    .set('x-request-id', 'req-audit-002');
  assert.equal(notFound.status, 404);
  assert.equal(notFound.body.error.code, 'DEVICE_NOT_FOUND');
  assert.equal(notFound.body.request_id, 'req-audit-002');
});

test('Provisioning strict paths: ONT requires passive->OLT chain, AON_CPE requires direct AON_SWITCH upstream', async () => {
  const ontOnlyRes = await request(app).post('/api/devices').send({
    name: 'ONT-ISOLATED',
    type: 'ONT',
    x: 320,
    y: 120,
  });
  assert.equal(ontOnlyRes.status, 201);
  const isolatedOntId = ontOnlyRes.body.id as string;

  const isolatedOntProvision = await request(app).post(`/api/devices/${isolatedOntId}/provision`).send({});
  assert.equal(isolatedOntProvision.status, 400);
  assert.equal(isolatedOntProvision.body.error.code, 'INVALID_PROVISION_PATH');

  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-PROV',
    type: 'OLT',
    x: 80,
    y: 80,
  });
  assert.equal(oltRes.status, 201);

  const splitterRes = await request(app).post('/api/devices').send({
    name: 'SPLITTER-PROV',
    type: 'SPLITTER',
    x: 160,
    y: 120,
  });
  assert.equal(splitterRes.status, 201);

  const ontRes = await request(app).post('/api/devices').send({
    name: 'ONT-PROV',
    type: 'ONT',
    x: 260,
    y: 140,
  });
  assert.equal(ontRes.status, 201);

  const oltPon = oltRes.body.ports.find((port: any) => port.portType === 'PON');
  const splitterIn = splitterRes.body.ports.find((port: any) => port.portType === 'IN');
  const splitterOut = splitterRes.body.ports.find((port: any) => port.portType === 'OUT');
  const ontPon = ontRes.body.ports.find((port: any) => port.portType === 'PON');
  assert.ok(oltPon?.id);
  assert.ok(splitterIn?.id);
  assert.ok(splitterOut?.id);
  assert.ok(ontPon?.id);

  const oltToSplitter = await request(app).post('/api/links').send({
    a_interface_id: oltPon.id,
    b_interface_id: splitterIn.id,
    length_km: 1.2,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(oltToSplitter.status, 201);

  const splitterToOnt = await request(app).post('/api/links').send({
    a_interface_id: splitterOut.id,
    b_interface_id: ontPon.id,
    length_km: 0.4,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(splitterToOnt.status, 201);

  const ontProvision = await request(app).post(`/api/devices/${ontRes.body.id}/provision`).send({});
  assert.equal(ontProvision.status, 200);

  const aonCpeOnlyRes = await request(app).post('/api/devices').send({
    name: 'AON-CPE-ISOLATED',
    type: 'AON_CPE',
    x: 420,
    y: 220,
  });
  assert.equal(aonCpeOnlyRes.status, 201);

  const isolatedCpeProvision = await request(app).post(`/api/devices/${aonCpeOnlyRes.body.id}/provision`).send({});
  assert.equal(isolatedCpeProvision.status, 400);
  assert.equal(isolatedCpeProvision.body.error.code, 'INVALID_PROVISION_PATH');

  const aonSwitchRes = await request(app).post('/api/devices').send({
    name: 'AON-SW-1',
    type: 'AON_SWITCH',
    x: 380,
    y: 180,
  });
  assert.equal(aonSwitchRes.status, 201);

  const aonCpeRes = await request(app).post('/api/devices').send({
    name: 'AON-CPE-1',
    type: 'AON_CPE',
    x: 460,
    y: 220,
  });
  assert.equal(aonCpeRes.status, 201);

  const switchAccess = aonSwitchRes.body.ports.find((port: any) => port.portType === 'ACCESS');
  const cpeAccess = aonCpeRes.body.ports.find((port: any) => port.portType === 'ACCESS');
  assert.ok(switchAccess?.id);
  assert.ok(cpeAccess?.id);

  const aonEdge = await request(app).post('/api/links').send({
    a_interface_id: switchAccess.id,
    b_interface_id: cpeAccess.id,
  });
  assert.equal(aonEdge.status, 201);

  const aonCpeProvision = await request(app).post(`/api/devices/${aonCpeRes.body.id}/provision`).send({});
  assert.equal(aonCpeProvision.status, 200);
});
