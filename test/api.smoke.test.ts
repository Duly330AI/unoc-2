import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { once } from 'node:events';
import { io as createSocketClient } from 'socket.io-client';

process.env.NODE_ENV = 'test';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const prismaDir = path.resolve(repoRoot, 'prisma');
const testDbFileName = `test-${process.pid}.db`;
const testDb = path.join(prismaDir, testDbFileName);
const testDbWal = `${testDb}-wal`;
const testDbShm = `${testDb}-shm`;

if (fs.existsSync(testDb)) {
  fs.rmSync(testDb);
}
if (fs.existsSync(testDbWal)) {
  fs.rmSync(testDbWal);
}
if (fs.existsSync(testDbShm)) {
  fs.rmSync(testDbShm);
}

process.env.DATABASE_URL = `file:./${testDbFileName}`;
execSync('npx prisma db push --skip-generate', {
  cwd: repoRoot,
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  stdio: 'pipe',
});

const {
  app,
  prisma,
  httpServer,
  stopTrafficLoop,
  resetSimulationState,
  runTrafficSimulationTick,
  clampDownstreamDemands,
  ensureNoPrimaryIpExists,
  emitEvent,
  flushRealtimeOutbox,
} =
  await import('../server.ts');

test.beforeEach(async () => {
  resetSimulationState();
  await prisma.oltVlanTranslation.deleteMany();
  await prisma.cgnatMapping.deleteMany();
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
  if (httpServer.listening) {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
  await prisma.$disconnect();
  if (fs.existsSync(testDb)) {
    fs.rmSync(testDb);
  }
  if (fs.existsSync(testDbWal)) {
    fs.rmSync(testDbWal);
  }
  if (fs.existsSync(testDbShm)) {
    fs.rmSync(testDbShm);
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

  const vlanMappingRes = await request(app).post(`/api/devices/${oltId}/vlan-mappings`).send({
    cTag: 100,
    sTag: 1010,
    serviceType: 'INTERNET',
  });
  assert.equal(vlanMappingRes.status, 201);
  assert.equal(vlanMappingRes.body.deviceId, oltId);
  assert.equal(vlanMappingRes.body.cTag, 100);
  assert.equal(vlanMappingRes.body.sTag, 1010);
  assert.equal(vlanMappingRes.body.serviceType, 'INTERNET');

  const vlanMapping = await prisma.oltVlanTranslation.findUnique({
    where: {
      deviceId_cTag: {
        deviceId: oltId,
        cTag: 100,
      },
    },
  });
  assert.ok(vlanMapping);
  assert.equal(vlanMapping.sTag, 1010);
  assert.equal(vlanMapping.serviceType, 'INTERNET');
});

test('Optical path endpoint returns deterministic SHA-256 path signature and required cost fields', async () => {
  const oltRes = await request(app).post('/api/devices').send({
    name: 'OPT-OLT-1',
    type: 'OLT',
    x: 10,
    y: 10,
  });
  const splitterRes = await request(app).post('/api/devices').send({
    name: 'OPT-SPLITTER-1',
    type: 'SPLITTER',
    x: 50,
    y: 10,
  });
  const ontRes = await request(app).post('/api/devices').send({
    name: 'OPT-ONT-1',
    type: 'ONT',
    x: 90,
    y: 10,
  });

  const oltPon = oltRes.body.ports.find((port: any) => port.portType === 'PON');
  const splitterIn = splitterRes.body.ports.find((port: any) => port.portType === 'IN');
  const splitterOut = splitterRes.body.ports.find((port: any) => port.portType === 'OUT');
  const ontPon = ontRes.body.ports.find((port: any) => port.portType === 'PON');

  assert.ok(oltPon?.id);
  assert.ok(splitterIn?.id);
  assert.ok(splitterOut?.id);
  assert.ok(ontPon?.id);

  const feederRes = await request(app).post('/api/links').send({
    a_interface_id: oltPon.id,
    b_interface_id: splitterIn.id,
    length_km: 1.2,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(feederRes.status, 201);

  const accessRes = await request(app).post('/api/links').send({
    a_interface_id: splitterOut.id,
    b_interface_id: ontPon.id,
    length_km: 0.8,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(accessRes.status, 201);

  const opticalRes = await request(app).get(`/api/devices/${ontRes.body.id}/optical-path`);
  assert.equal(opticalRes.status, 200);
  assert.equal(opticalRes.body.found, true);
  assert.equal(opticalRes.body.path.olt_id, oltRes.body.id);
  assert.ok(Array.isArray(opticalRes.body.path.device_ids));
  assert.ok(Array.isArray(opticalRes.body.path.link_ids));
  assert.equal(typeof opticalRes.body.path.total_loss_db, 'number');
  assert.equal(typeof opticalRes.body.path.total_link_loss_db, 'number');
  assert.equal(typeof opticalRes.body.path.total_passive_loss_db, 'number');
  assert.equal(typeof opticalRes.body.path.total_physical_length_km, 'number');
  assert.equal(typeof opticalRes.body.path.hop_count, 'number');
  assert.match(opticalRes.body.path.path_signature, /^[0-9a-f]{64}$/);

  const canonicalTokens: string[] = [];
  const deviceIds = opticalRes.body.path.device_ids as string[];
  const linkIds = opticalRes.body.path.link_ids as string[];
  for (let index = 0; index < deviceIds.length; index += 1) {
    canonicalTokens.push(`N:${deviceIds[index]}`);
    if (index < linkIds.length) {
      canonicalTokens.push(`L:${linkIds[index]}`);
    }
  }
  const expectedSignature = createHash('sha256').update(canonicalTokens.join(',')).digest('hex');
  assert.equal(opticalRes.body.path.path_signature, expectedSignature);
});

test('Optical path resolver chooses deterministic OLT winner for equal-cost candidates', async () => {
  const ontRes = await request(app).post('/api/devices').send({
    name: 'OPT-EQUAL-ONT-1',
    type: 'ONT',
    x: 10,
    y: 10,
  });
  const splitterRes = await request(app).post('/api/devices').send({
    name: 'OPT-EQUAL-SPLITTER-1',
    type: 'SPLITTER',
    x: 40,
    y: 10,
  });
  const oltARes = await request(app).post('/api/devices').send({
    name: 'OPT-EQUAL-OLT-A',
    type: 'OLT',
    x: 70,
    y: 0,
  });
  const oltBRes = await request(app).post('/api/devices').send({
    name: 'OPT-EQUAL-OLT-B',
    type: 'OLT',
    x: 70,
    y: 20,
  });

  const ontPon = ontRes.body.ports.find((port: any) => port.portType === 'PON');
  const splitterIn = splitterRes.body.ports.find((port: any) => port.portType === 'IN');
  const splitterOutPorts = splitterRes.body.ports.filter((port: any) => port.portType === 'OUT');
  const oltAPon = oltARes.body.ports.find((port: any) => port.portType === 'PON');
  const oltBPon = oltBRes.body.ports.find((port: any) => port.portType === 'PON');

  assert.ok(ontPon?.id);
  assert.ok(splitterIn?.id);
  assert.ok(splitterOutPorts.length >= 2);
  assert.ok(oltAPon?.id);
  assert.ok(oltBPon?.id);

  await prisma.link.create({
    data: {
      sourcePortId: ontPon.id,
      targetPortId: splitterOutPorts[0].id,
      fiberLength: 1,
      fiberType: 'G.652.D',
      status: 'UP',
    },
  });
  await prisma.link.create({
    data: {
      sourcePortId: oltAPon.id,
      targetPortId: splitterIn.id,
      fiberLength: 1,
      fiberType: 'G.652.D',
      status: 'UP',
    },
  });
  await prisma.link.create({
    data: {
      sourcePortId: oltBPon.id,
      targetPortId: splitterOutPorts[1].id,
      fiberLength: 1,
      fiberType: 'G.652.D',
      status: 'UP',
    },
  });

  const opticalRes = await request(app).get(`/api/devices/${ontRes.body.id}/optical-path`);
  assert.equal(opticalRes.status, 200);
  assert.equal(opticalRes.body.found, true);

  const expectedOltId = [oltARes.body.id, oltBRes.body.id].sort()[0];
  assert.equal(opticalRes.body.path.olt_id, expectedOltId);
  assert.match(opticalRes.body.path.path_signature, /^[0-9a-f]{64}$/);
});

test('Optical path resolver prefers lower total attenuation even when the winning path is physically longer', async () => {
  const ontRes = await request(app).post('/api/devices').send({
    name: 'OPT-LOSS-ONT-1',
    type: 'ONT',
    x: 10,
    y: 10,
  });
  const splitterRes = await request(app).post('/api/devices').send({
    name: 'OPT-LOSS-SPLITTER-1',
    type: 'SPLITTER',
    x: 40,
    y: 0,
  });
  const odfRes = await request(app).post('/api/devices').send({
    name: 'OPT-LOSS-ODF-1',
    type: 'ODF',
    x: 40,
    y: 20,
  });
  const oltARes = await request(app).post('/api/devices').send({
    name: 'OPT-LOSS-OLT-A',
    type: 'OLT',
    x: 70,
    y: 0,
  });
  const oltBRes = await request(app).post('/api/devices').send({
    name: 'OPT-LOSS-OLT-B',
    type: 'OLT',
    x: 70,
    y: 20,
  });

  const ontPon = ontRes.body.ports.find((port: any) => port.portType === 'PON');
  const splitterIn = splitterRes.body.ports.find((port: any) => port.portType === 'IN');
  const splitterOut = splitterRes.body.ports.find((port: any) => port.portType === 'OUT');
  const odfIn = odfRes.body.ports.find((port: any) => port.portType === 'IN');
  const odfOut = odfRes.body.ports.find((port: any) => port.portType === 'OUT');
  const oltAPon = oltARes.body.ports.find((port: any) => port.portType === 'PON');
  const oltBPon = oltBRes.body.ports.find((port: any) => port.portType === 'PON');

  assert.ok(ontPon?.id);
  assert.ok(splitterIn?.id);
  assert.ok(splitterOut?.id);
  assert.ok(odfIn?.id);
  assert.ok(odfOut?.id);
  assert.ok(oltAPon?.id);
  assert.ok(oltBPon?.id);

  await prisma.link.create({
    data: {
      sourcePortId: ontPon.id,
      targetPortId: splitterOut.id,
      fiberLength: 0.1,
      fiberType: 'G.652.D',
      status: 'UP',
    },
  });
  await prisma.link.create({
    data: {
      sourcePortId: oltAPon.id,
      targetPortId: splitterIn.id,
      fiberLength: 0.1,
      fiberType: 'G.652.D',
      status: 'UP',
    },
  });
  await prisma.link.create({
    data: {
      sourcePortId: odfOut.id,
      targetPortId: ontPon.id,
      fiberLength: 1.5,
      fiberType: 'G.652.D',
      status: 'UP',
    },
  });
  await prisma.link.create({
    data: {
      sourcePortId: oltBPon.id,
      targetPortId: odfIn.id,
      fiberLength: 1.5,
      fiberType: 'G.652.D',
      status: 'UP',
    },
  });

  const opticalRes = await request(app).get(`/api/devices/${ontRes.body.id}/optical-path`);
  assert.equal(opticalRes.status, 200);
  assert.equal(opticalRes.body.found, true);
  assert.equal(opticalRes.body.path.olt_id, oltBRes.body.id);
  assert.ok(opticalRes.body.path.total_passive_loss_db < 3.5);
  assert.ok(opticalRes.body.path.total_physical_length_km > 2);
});

test('Optical path endpoint reflects link length and medium mutations deterministically', async () => {
  const oltRes = await request(app).post('/api/devices').send({
    name: 'OPT-MUT-OLT-1',
    type: 'OLT',
    x: 10,
    y: 10,
  });
  const splitterRes = await request(app).post('/api/devices').send({
    name: 'OPT-MUT-SPLITTER-1',
    type: 'SPLITTER',
    x: 40,
    y: 10,
  });
  const ontRes = await request(app).post('/api/devices').send({
    name: 'OPT-MUT-ONT-1',
    type: 'ONT',
    x: 70,
    y: 10,
  });

  const oltPon = oltRes.body.ports.find((port: any) => port.portType === 'PON');
  const splitterIn = splitterRes.body.ports.find((port: any) => port.portType === 'IN');
  const splitterOut = splitterRes.body.ports.find((port: any) => port.portType === 'OUT');
  const ontPon = ontRes.body.ports.find((port: any) => port.portType === 'PON');

  assert.ok(oltPon?.id);
  assert.ok(splitterIn?.id);
  assert.ok(splitterOut?.id);
  assert.ok(ontPon?.id);

  const feederRes = await request(app).post('/api/links').send({
    a_interface_id: oltPon.id,
    b_interface_id: splitterIn.id,
    length_km: 1.0,
    physical_medium_id: 'G.652.D',
  });
  const accessRes = await request(app).post('/api/links').send({
    a_interface_id: splitterOut.id,
    b_interface_id: ontPon.id,
    length_km: 0.5,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(feederRes.status, 201);
  assert.equal(accessRes.status, 201);

  const initialRes = await request(app).get(`/api/devices/${ontRes.body.id}/optical-path`);
  assert.equal(initialRes.status, 200);
  const initialPath = initialRes.body.path;

  const updatedLengthRes = await request(app).patch(`/api/links/${feederRes.body.id}`).send({
    length_km: 5.0,
  });
  assert.equal(updatedLengthRes.status, 200);

  const afterLengthRes = await request(app).get(`/api/devices/${ontRes.body.id}/optical-path`);
  assert.equal(afterLengthRes.status, 200);
  assert.equal(afterLengthRes.body.path.path_signature, initialPath.path_signature);
  assert.ok(afterLengthRes.body.path.total_loss_db > initialPath.total_loss_db);
  assert.ok(afterLengthRes.body.path.total_link_loss_db > initialPath.total_link_loss_db);

  const updatedMediumRes = await request(app).patch(`/api/links/${feederRes.body.id}`).send({
    physical_medium_id: 'MMF',
  });
  assert.equal(updatedMediumRes.status, 200);

  const afterMediumRes = await request(app).get(`/api/devices/${ontRes.body.id}/optical-path`);
  assert.equal(afterMediumRes.status, 200);
  assert.equal(afterMediumRes.body.path.path_signature, initialPath.path_signature);
  assert.ok(afterMediumRes.body.path.total_loss_db > afterLengthRes.body.path.total_loss_db);
});

test('Provisioning CAS allows only one concurrent winner and avoids duplicate management resources', async () => {
  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-CAS',
    type: 'OLT',
    x: 25,
    y: 25,
  });
  assert.equal(oltRes.status, 201);

  const [firstProvisionRes, secondProvisionRes] = await Promise.all([
    request(app).post(`/api/devices/${oltRes.body.id}/provision`).send({}),
    request(app).post(`/api/devices/${oltRes.body.id}/provision`).send({}),
  ]);

  const statuses = [firstProvisionRes.status, secondProvisionRes.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409]);

  const conflictRes = [firstProvisionRes, secondProvisionRes].find((response) => response.status === 409);
  assert.ok(conflictRes);
  assert.equal(conflictRes.body.error.code, 'ALREADY_PROVISIONED');

  const mgmtInterfaces = await prisma.interface.findMany({
    where: {
      deviceId: oltRes.body.id,
      name: 'mgmt0',
    },
  });
  assert.equal(mgmtInterfaces.length, 1);

  const mgmtAddresses = await prisma.ipAddress.findMany({
    where: {
      interfaceId: mgmtInterfaces[0].id,
      vrf: 'mgmt_vrf',
      isPrimary: true,
    },
  });
  assert.equal(mgmtAddresses.length, 1);
});

test('Primary IP guard rejects a second primary address on the same interface and VRF', async () => {
  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-PRIMARY-GUARD',
    type: 'OLT',
    x: 35,
    y: 35,
  });
  assert.equal(oltRes.status, 201);

  const provisionRes = await request(app).post(`/api/devices/${oltRes.body.id}/provision`).send({});
  assert.equal(provisionRes.status, 200);

  const mgmtInterface = await prisma.interface.findUnique({
    where: {
      deviceId_name: {
        deviceId: oltRes.body.id,
        name: 'mgmt0',
      },
    },
  });
  assert.ok(mgmtInterface);

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await ensureNoPrimaryIpExists(tx, mgmtInterface.id, 'mgmt_vrf');
      await tx.ipAddress.create({
        data: {
          interfaceId: mgmtInterface.id,
          ip: '10.250.4.250',
          prefixLen: 24,
          isPrimary: true,
          vrf: 'mgmt_vrf',
        },
      });
    }),
    (error: any) => error?.code === 'DUPLICATE_PRIMARY_IP'
  );

  const mgmtAddresses = await prisma.ipAddress.findMany({
    where: {
      interfaceId: mgmtInterface.id,
      vrf: 'mgmt_vrf',
      isPrimary: true,
    },
  });
  assert.equal(mgmtAddresses.length, 1);
});

test('Realtime outbox flushes events in deterministic phase order and dedupes status items', async () => {
  if (!httpServer.listening) {
    await new Promise<void>((resolve, reject) => {
      httpServer.listen(0, '127.0.0.1', (error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  const address = httpServer.address();
  assert.ok(address && typeof address === 'object' && 'port' in address);

  const client = createSocketClient(`http://127.0.0.1:${address.port}`, {
    path: '/api/socket.io',
    transports: ['websocket'],
  });
  await once(client, 'connect');

  const received: Array<{ kind: string; payload: any }> = [];
  client.on('event', (envelope) => {
    received.push({ kind: envelope.kind, payload: envelope.payload });
  });

  const correlationId = 'rt-order-test';
  emitEvent(
    'deviceCreated',
    {
      id: 'device-1',
      name: 'Realtime Device',
      status: 'DOWN',
    },
    true,
    correlationId
  );
  emitEvent(
    'deviceStatusUpdated',
    {
      tick: 1,
      items: [{ id: 'device-1', status: 'DOWN' }],
    },
    false,
    correlationId
  );
  emitEvent(
    'deviceStatusUpdated',
    {
      tick: 1,
      items: [{ id: 'device-1', status: 'UP' }],
    },
    false,
    correlationId
  );
  emitEvent(
    'deviceSignalUpdated',
    {
      tick: 1,
      items: [{ id: 'device-1', received_dbm: -12.5, signal_status: 'OK' }],
    },
    false,
    correlationId
  );
  emitEvent(
    'deviceMetricsUpdated',
    {
      tick: 1,
      items: [
        {
          id: 'device-1',
          trafficLoad: 10,
          trafficMbps: 100,
          rxPower: -12.5,
          status: 'UP',
          metric_tick_seq: 1,
        },
      ],
    },
    false,
    correlationId
  );

  flushRealtimeOutbox(correlationId);

  await new Promise((resolve) => setTimeout(resolve, 100));

  client.disconnect();

  assert.equal(received.length, 4);
  assert.deepEqual(
    received.map((entry) => entry.kind),
    ['deviceCreated', 'deviceSignalUpdated', 'deviceStatusUpdated', 'deviceMetricsUpdated']
  );
  assert.equal(received[2].payload.items.length, 1);
  assert.equal(received[2].payload.items[0].status, 'UP');
});

test('Realtime tick emits signal, status, and metrics in phased order with coherent runtime status', async () => {
  if (!httpServer.listening) {
    await new Promise<void>((resolve, reject) => {
      httpServer.listen(0, '127.0.0.1', (error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  const popRes = await request(app).post('/api/devices').send({
    name: 'POP-RT-1',
    type: 'POP',
    x: 10,
    y: 10,
  });
  assert.equal(popRes.status, 201);

  const address = httpServer.address();
  assert.ok(address && typeof address === 'object' && 'port' in address);

  const client = createSocketClient(`http://127.0.0.1:${address.port}`, {
    path: '/api/socket.io',
    transports: ['websocket'],
  });
  await once(client, 'connect');

  const received: Array<{ kind: string; payload: any }> = [];
  client.on('event', (envelope) => {
    received.push({ kind: envelope.kind, payload: envelope.payload });
  });

  await runTrafficSimulationTick();
  await new Promise((resolve) => setTimeout(resolve, 100));

  client.disconnect();

  const signalEvent = received.find((entry) => entry.kind === 'deviceSignalUpdated');
  const statusEvent = received.find((entry) => entry.kind === 'deviceStatusUpdated');
  const metricsEvent = received.find((entry) => entry.kind === 'deviceMetricsUpdated');
  assert.ok(signalEvent);
  assert.ok(statusEvent);
  assert.ok(metricsEvent);

  const signalIndex = received.findIndex((entry) => entry.kind === 'deviceSignalUpdated');
  const statusIndex = received.findIndex((entry) => entry.kind === 'deviceStatusUpdated');
  const metricsIndex = received.findIndex((entry) => entry.kind === 'deviceMetricsUpdated');
  assert.ok(signalIndex >= 0 && statusIndex >= 0 && metricsIndex >= 0);
  assert.ok(signalIndex < statusIndex);
  assert.ok(statusIndex < metricsIndex);

  const signalItem = signalEvent.payload.items.find((item: any) => item.id === popRes.body.id);
  const statusItem = statusEvent.payload.items.find((item: any) => item.id === popRes.body.id);
  const metricsItem = metricsEvent.payload.items.find((item: any) => item.id === popRes.body.id);
  assert.ok(signalItem);
  assert.ok(statusItem);
  assert.ok(metricsItem);
  assert.equal(statusItem.status, 'UP');
  assert.equal(metricsItem.status, 'UP');
  assert.equal(signalItem.signal_status, 'OK');
  assert.equal(signalEvent.payload.tick, statusEvent.payload.tick);
  assert.equal(statusEvent.payload.tick, metricsEvent.payload.tick);
  assert.equal(metricsItem.metric_tick_seq, metricsEvent.payload.tick);
});

test('Realtime tick reflects explicit override changes coherently across signal and status events', async () => {
  if (!httpServer.listening) {
    await new Promise<void>((resolve, reject) => {
      httpServer.listen(0, '127.0.0.1', (error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  const popRes = await request(app).post('/api/devices').send({
    name: 'POP-RT-OVERRIDE-1',
    type: 'POP',
    x: 20,
    y: 20,
  });
  assert.equal(popRes.status, 201);

  const address = httpServer.address();
  assert.ok(address && typeof address === 'object' && 'port' in address);

  const client = createSocketClient(`http://127.0.0.1:${address.port}`, {
    path: '/api/socket.io',
    transports: ['websocket'],
  });
  await once(client, 'connect');

  const received: Array<{ kind: string; payload: any }> = [];
  client.on('event', (envelope) => {
    received.push({ kind: envelope.kind, payload: envelope.payload });
  });

  await runTrafficSimulationTick();
  await new Promise((resolve) => setTimeout(resolve, 100));
  received.length = 0;

  const overrideRes = await request(app).patch(`/api/devices/${popRes.body.id}/override`).send({
    admin_override_status: 'DOWN',
  });
  assert.equal(overrideRes.status, 200);

  await runTrafficSimulationTick();
  await new Promise((resolve) => setTimeout(resolve, 100));

  client.disconnect();

  const signalEvent = received.filter((entry) => entry.kind === 'deviceSignalUpdated').at(-1);
  const statusEvent = received.filter((entry) => entry.kind === 'deviceStatusUpdated').at(-1);
  const metricsEvent = received.filter((entry) => entry.kind === 'deviceMetricsUpdated').at(-1);
  assert.ok(signalEvent);
  assert.ok(statusEvent);
  assert.ok(metricsEvent);

  const signalItem = signalEvent.payload.items.find((item: any) => item.id === popRes.body.id);
  const statusItem = statusEvent.payload.items.find((item: any) => item.id === popRes.body.id);
  const metricsItem = metricsEvent.payload.items.find((item: any) => item.id === popRes.body.id);
  assert.ok(signalItem);
  assert.ok(statusItem);
  assert.ok(metricsItem);
  assert.equal(statusItem.status, 'DOWN');
  assert.equal(metricsItem.status, 'DOWN');
  assert.equal(signalItem.signal_status, 'NO_SIGNAL');
});

test('Device override emits deviceOverrideChanged and overrideConflict for invalid UP override path', async () => {
  if (!httpServer.listening) {
    await new Promise<void>((resolve, reject) => {
      httpServer.listen(0, '127.0.0.1', (error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  const ontRes = await request(app).post('/api/devices').send({
    name: 'ONT-OVERRIDE-CONFLICT-1',
    type: 'ONT',
    x: 30,
    y: 30,
  });
  assert.equal(ontRes.status, 201);

  const address = httpServer.address();
  assert.ok(address && typeof address === 'object' && 'port' in address);

  const client = createSocketClient(`http://127.0.0.1:${address.port}`, {
    path: '/api/socket.io',
    transports: ['websocket'],
  });
  await once(client, 'connect');

  const received: Array<{ kind: string; payload: any }> = [];
  client.on('event', (envelope) => {
    received.push({ kind: envelope.kind, payload: envelope.payload });
  });

  const overrideRes = await request(app).patch(`/api/devices/${ontRes.body.id}/override`).send({
    admin_override_status: 'UP',
  });
  assert.equal(overrideRes.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 100));

  client.disconnect();

  const kinds = received.map((entry) => entry.kind);
  const overrideChanged = received.find((entry) => entry.kind === 'deviceOverrideChanged');
  const conflict = received.find((entry) => entry.kind === 'overrideConflict');
  assert.ok(overrideChanged);
  assert.ok(conflict);
  assert.ok(kinds.indexOf('deviceOverrideChanged') < kinds.indexOf('overrideConflict'));
  assert.equal(overrideChanged.payload.id, ontRes.body.id);
  assert.equal(overrideChanged.payload.override, 'UP');
  assert.equal(overrideChanged.payload.status, 'UP');
  assert.equal(conflict.payload.entity, 'device');
  assert.equal(conflict.payload.id, ontRes.body.id);
  assert.equal(conflict.payload.reason, 'override_up_without_required_path');
});

test('Link override emits linkStatusUpdated and overrideConflict when forcing UP against DOWN endpoint', async () => {
  if (!httpServer.listening) {
    await new Promise<void>((resolve, reject) => {
      httpServer.listen(0, '127.0.0.1', (error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  const edgeRes = await request(app).post('/api/devices').send({
    name: 'EDGE-LINK-OVERRIDE-1',
    type: 'EDGE_ROUTER',
    x: 60,
    y: 60,
  });
  assert.equal(edgeRes.status, 201);

  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-LINK-OVERRIDE-1',
    type: 'OLT',
    x: 110,
    y: 110,
  });
  assert.equal(oltRes.status, 201);

  const edgeAccess = edgeRes.body.ports.find((port: any) => port.portType === 'ACCESS');
  const oltUplink = oltRes.body.ports.find((port: any) => port.portType === 'UPLINK');
  assert.ok(edgeAccess?.id);
  assert.ok(oltUplink?.id);

  const linkRes = await request(app).post('/api/links').send({
    a_interface_id: edgeAccess.id,
    b_interface_id: oltUplink.id,
  });
  assert.equal(linkRes.status, 201);

  const address = httpServer.address();
  assert.ok(address && typeof address === 'object' && 'port' in address);

  const client = createSocketClient(`http://127.0.0.1:${address.port}`, {
    path: '/api/socket.io',
    transports: ['websocket'],
  });
  await once(client, 'connect');

  const received: Array<{ kind: string; payload: any }> = [];
  client.on('event', (envelope) => {
    received.push({ kind: envelope.kind, payload: envelope.payload });
  });

  const overrideRes = await request(app).patch(`/api/links/${linkRes.body.id}/override`).send({
    admin_override_status: 'UP',
  });
  assert.equal(overrideRes.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 100));

  client.disconnect();

  const kinds = received.map((entry) => entry.kind);
  const linkStatus = received.find((entry) => entry.kind === 'linkStatusUpdated');
  const conflict = received.find((entry) => entry.kind === 'overrideConflict');
  assert.ok(linkStatus);
  assert.ok(conflict);
  assert.ok(kinds.indexOf('linkStatusUpdated') < kinds.indexOf('overrideConflict'));
  assert.equal(linkStatus.payload.id, linkRes.body.id);
  assert.equal(linkStatus.payload.admin_override_status, 'UP');
  assert.equal(linkStatus.payload.effective_status, 'UP');
  assert.equal(conflict.payload.entity, 'link');
  assert.equal(conflict.payload.id, linkRes.body.id);
  assert.equal(conflict.payload.reason, 'override_up_with_down_endpoint');
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

test('Router link creation allocates deterministic /31 addresses atomically', async () => {
  const coreRes = await request(app).post('/api/devices').send({
    name: 'CORE-RTR-1',
    type: 'CORE_ROUTER',
    x: 100,
    y: 40,
  });
  assert.equal(coreRes.status, 201);

  const edgeRes = await request(app).post('/api/devices').send({
    name: 'EDGE-RTR-1',
    type: 'EDGE_ROUTER',
    x: 220,
    y: 60,
  });
  assert.equal(edgeRes.status, 201);

  const coreId = coreRes.body.id as string;
  const edgeId = edgeRes.body.id as string;

  const coreProvision = await request(app).post(`/api/devices/${coreId}/provision`).send({});
  assert.equal(coreProvision.status, 200);

  const edgeProvision = await request(app).post(`/api/devices/${edgeId}/provision`).send({});
  assert.equal(edgeProvision.status, 200);

  const coreUplink = coreRes.body.ports.find((port: any) => port.portType === 'UPLINK');
  const edgeUplink = edgeRes.body.ports.find((port: any) => port.portType === 'UPLINK');
  assert.ok(coreUplink?.id);
  assert.ok(edgeUplink?.id);

  const linkRes = await request(app).post('/api/links').send({
    a_interface_id: coreUplink.id,
    b_interface_id: edgeUplink.id,
    length_km: 5,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(linkRes.status, 201);

  const [coreInterface, edgeInterface] = await Promise.all([
    prisma.interface.findUnique({
      where: {
        deviceId_name: {
          deviceId: coreId,
          name: 'uplink0',
        },
      },
      include: { addresses: true },
    }),
    prisma.interface.findUnique({
      where: {
        deviceId_name: {
          deviceId: edgeId,
          name: 'uplink0',
        },
      },
      include: { addresses: true },
    }),
  ]);

  assert.ok(coreInterface);
  assert.ok(edgeInterface);

  const coreP2p = coreInterface.addresses.filter((address) => address.vrf === 'infra_vrf');
  const edgeP2p = edgeInterface.addresses.filter((address) => address.vrf === 'infra_vrf');
  assert.equal(coreP2p.length, 1);
  assert.equal(edgeP2p.length, 1);
  assert.equal(coreP2p[0].prefixLen, 31);
  assert.equal(edgeP2p[0].prefixLen, 31);

  const orderedIds = [coreId, edgeId].sort((a, b) => a.localeCompare(b));
  const lowerIdIp = orderedIds[0] === coreId ? coreP2p[0].ip : edgeP2p[0].ip;
  const higherIdIp = orderedIds[1] === edgeId ? edgeP2p[0].ip : coreP2p[0].ip;

  const parseIp = (ip: string) => ip.split('.').map(Number).reduce((acc, octet) => (acc << 8) + octet, 0) >>> 0;
  assert.equal(parseIp(higherIdIp) - parseIp(lowerIdIp), 1);
  assert.ok(lowerIdIp.startsWith('10.250.255.'));
  assert.ok(higherIdIp.startsWith('10.250.255.'));
});

test('Deleting a router link reclaims /31 addresses and port-backed interfaces', async () => {
  const coreRes = await request(app).post('/api/devices').send({
    name: 'CORE-RTR-DEL-1',
    type: 'CORE_ROUTER',
    x: 80,
    y: 40,
  });
  assert.equal(coreRes.status, 201);

  const edgeRes = await request(app).post('/api/devices').send({
    name: 'EDGE-RTR-DEL-1',
    type: 'EDGE_ROUTER',
    x: 180,
    y: 40,
  });
  assert.equal(edgeRes.status, 201);

  const coreId = coreRes.body.id as string;
  const edgeId = edgeRes.body.id as string;

  assert.equal((await request(app).post(`/api/devices/${coreId}/provision`).send({})).status, 200);
  assert.equal((await request(app).post(`/api/devices/${edgeId}/provision`).send({})).status, 200);

  const coreUplink = coreRes.body.ports.find((port: any) => port.portType === 'UPLINK');
  const edgeUplink = edgeRes.body.ports.find((port: any) => port.portType === 'UPLINK');
  assert.ok(coreUplink?.id);
  assert.ok(edgeUplink?.id);

  const createRes = await request(app).post('/api/links').send({
    a_interface_id: coreUplink.id,
    b_interface_id: edgeUplink.id,
    length_km: 5,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(createRes.status, 201);
  const linkId = createRes.body.id as string;

  const allocatedBeforeDelete = await prisma.ipAddress.findMany({
    where: {
      vrf: 'infra_vrf',
    },
    orderBy: { ip: 'asc' },
  });
  assert.equal(allocatedBeforeDelete.length, 2);

  const deleteRes = await request(app).delete(`/api/links/${linkId}`);
  assert.equal(deleteRes.status, 204);

  const [linkAfterDelete, coreInterfaceAfterDelete, edgeInterfaceAfterDelete, allocatedAfterDelete] = await Promise.all([
    prisma.link.findUnique({ where: { id: linkId } }),
    prisma.interface.findUnique({
      where: {
        deviceId_name: {
          deviceId: coreId,
          name: 'uplink0',
        },
      },
    }),
    prisma.interface.findUnique({
      where: {
        deviceId_name: {
          deviceId: edgeId,
          name: 'uplink0',
        },
      },
    }),
    prisma.ipAddress.findMany({
      where: {
        vrf: 'infra_vrf',
      },
    }),
  ]);

  assert.equal(linkAfterDelete, null);
  assert.equal(coreInterfaceAfterDelete, null);
  assert.equal(edgeInterfaceAfterDelete, null);
  assert.equal(allocatedAfterDelete.length, 0);

  const recreateRes = await request(app).post('/api/links').send({
    a_interface_id: coreUplink.id,
    b_interface_id: edgeUplink.id,
    length_km: 5,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(recreateRes.status, 201);

  const recreatedAddresses = await prisma.ipAddress.findMany({
    where: {
      vrf: 'infra_vrf',
    },
    orderBy: { ip: 'asc' },
  });
  assert.equal(recreatedAddresses.length, 2);
  assert.deepEqual(
    recreatedAddresses.map((address) => address.ip),
    allocatedBeforeDelete.map((address) => address.ip)
  );
});

test('Batch deleting router links reclaims routed /31 allocations', async () => {
  const coreRes = await request(app).post('/api/devices').send({
    name: 'CORE-RTR-BATCH-1',
    type: 'CORE_ROUTER',
    x: 80,
    y: 120,
  });
  assert.equal(coreRes.status, 201);

  const edgeRes = await request(app).post('/api/devices').send({
    name: 'EDGE-RTR-BATCH-1',
    type: 'EDGE_ROUTER',
    x: 200,
    y: 120,
  });
  assert.equal(edgeRes.status, 201);

  const coreId = coreRes.body.id as string;
  const edgeId = edgeRes.body.id as string;
  assert.equal((await request(app).post(`/api/devices/${coreId}/provision`).send({})).status, 200);
  assert.equal((await request(app).post(`/api/devices/${edgeId}/provision`).send({})).status, 200);

  const coreUplink = coreRes.body.ports.find((port: any) => port.portType === 'UPLINK');
  const edgeUplink = edgeRes.body.ports.find((port: any) => port.portType === 'UPLINK');
  assert.ok(coreUplink?.id);
  assert.ok(edgeUplink?.id);

  const createRes = await request(app).post('/api/links').send({
    a_interface_id: coreUplink.id,
    b_interface_id: edgeUplink.id,
    length_km: 8,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(createRes.status, 201);
  const linkId = createRes.body.id as string;

  const batchDeleteRes = await request(app)
    .post('/api/links/batch/delete')
    .send({ link_ids: [linkId], request_id: 'batch-delete-router-link-1' });
  assert.equal(batchDeleteRes.status, 200);
  assert.deepEqual(batchDeleteRes.body.deleted_link_ids, [linkId]);
  assert.deepEqual(batchDeleteRes.body.failed_links, []);

  const [linkAfterDelete, infraAddressesAfterDelete] = await Promise.all([
    prisma.link.findUnique({ where: { id: linkId } }),
    prisma.ipAddress.findMany({ where: { vrf: 'infra_vrf' } }),
  ]);
  assert.equal(linkAfterDelete, null);
  assert.equal(infraAddressesAfterDelete.length, 0);

  const recreateRes = await request(app).post('/api/links').send({
    a_interface_id: coreUplink.id,
    b_interface_id: edgeUplink.id,
    length_km: 8,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(recreateRes.status, 201);
});

test('Subscriber lifecycle creates INIT sessions and transitions to ACTIVE only with valid BNG', async () => {
  const bngRes = await request(app).post('/api/devices').send({
    name: 'BNG-EDGE-1',
    type: 'EDGE_ROUTER',
    x: 120,
    y: 80,
  });
  assert.equal(bngRes.status, 201);

  const ontRes = await request(app).post('/api/devices').send({
    name: 'SUB-ONT-1',
    type: 'ONT',
    x: 260,
    y: 140,
  });
  assert.equal(ontRes.status, 201);

  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-BAD-BNG',
    type: 'OLT',
    x: 60,
    y: 20,
  });
  assert.equal(oltRes.status, 201);

  const splitterRes = await request(app).post('/api/devices').send({
    name: 'SPLITTER-SUB',
    type: 'SPLITTER',
    x: 180,
    y: 120,
  });
  assert.equal(splitterRes.status, 201);

  const oltPon = oltRes.body.ports.find((port: any) => port.portType === 'PON');
  const oltUplink = oltRes.body.ports.find((port: any) => port.portType === 'UPLINK');
  const splitterIn = splitterRes.body.ports.find((port: any) => port.portType === 'IN');
  const splitterOut = splitterRes.body.ports.find((port: any) => port.portType === 'OUT');
  const ontPon = ontRes.body.ports.find((port: any) => port.portType === 'PON');
  const bngAccess = bngRes.body.ports.find((port: any) => port.portType === 'ACCESS');
  assert.ok(oltPon?.id);
  assert.ok(oltUplink?.id);
  assert.ok(splitterIn?.id);
  assert.ok(splitterOut?.id);
  assert.ok(ontPon?.id);
  assert.ok(bngAccess?.id);

  const uplinkRes = await request(app).post('/api/links').send({
    a_interface_id: bngAccess.id,
    b_interface_id: oltUplink.id,
    length_km: 4.2,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(uplinkRes.status, 201);

  const feeder = await request(app).post('/api/links').send({
    a_interface_id: oltPon.id,
    b_interface_id: splitterIn.id,
    length_km: 1.1,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(feeder.status, 201);

  const access = await request(app).post('/api/links').send({
    a_interface_id: splitterOut.id,
    b_interface_id: ontPon.id,
    length_km: 0.3,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(access.status, 201);

  const bngProvision = await request(app).post(`/api/devices/${bngRes.body.id}/provision`).send({});
  assert.equal(bngProvision.status, 200);

  const oltProvision = await request(app).post(`/api/devices/${oltRes.body.id}/provision`).send({});
  assert.equal(oltProvision.status, 200);

  const ontProvision = await request(app).post(`/api/devices/${ontRes.body.id}/provision`).send({});
  assert.equal(ontProvision.status, 200);

  const ontMgmt = await prisma.interface.findUnique({
    where: {
      deviceId_name: {
        deviceId: ontRes.body.id,
        name: 'mgmt0',
      },
    },
  });
  assert.ok(ontMgmt);

  const sessionCreate = await request(app).post('/api/sessions').send({
    interfaceId: ontMgmt.id,
    bngDeviceId: bngRes.body.id,
    serviceType: 'INTERNET',
    protocol: 'DHCP',
    macAddress: '02:55:4e:aa:bb:cc',
  });
  assert.equal(sessionCreate.status, 201);
  assert.equal(sessionCreate.body.state, 'INIT');
  assert.equal(sessionCreate.body.infra_status, 'UP');
  assert.equal(sessionCreate.body.service_status, 'DEGRADED');
  assert.equal(sessionCreate.body.reason_code, 'SESSION_NOT_ACTIVE');

  const persistedSession = await prisma.subscriberSession.findUnique({
    where: { id: sessionCreate.body.session_id },
  });
  assert.ok(persistedSession);
  assert.equal(persistedSession.state, 'INIT');
  assert.equal(persistedSession.serviceStatus, 'DEGRADED');

  const invalidVlanActivateRes = await request(app).patch(`/api/sessions/${sessionCreate.body.session_id}`).send({
    state: 'ACTIVE',
  });
  assert.equal(invalidVlanActivateRes.status, 422);
  assert.equal(invalidVlanActivateRes.body.error.code, 'VLAN_PATH_INVALID');

  const vlanMappingRes = await request(app).post(`/api/devices/${oltRes.body.id}/vlan-mappings`).send({
    cTag: 100,
    sTag: 1010,
    serviceType: 'INTERNET',
  });
  assert.equal(vlanMappingRes.status, 201);

  const activateRes = await request(app).patch(`/api/sessions/${sessionCreate.body.session_id}`).send({
    state: 'ACTIVE',
  });
  assert.equal(activateRes.status, 200);
  assert.equal(activateRes.body.state, 'ACTIVE');
  assert.equal(activateRes.body.service_status, 'UP');
  assert.equal(activateRes.body.reason_code, null);

  const bngDownRes = await request(app).patch(`/api/devices/${bngRes.body.id}/override`).send({
    admin_override_status: 'DOWN',
  });
  assert.equal(bngDownRes.status, 200);

  const expiredSession = await prisma.subscriberSession.findUnique({
    where: { id: sessionCreate.body.session_id },
  });
  assert.ok(expiredSession);
  assert.equal(expiredSession.state, 'EXPIRED');
  assert.equal(expiredSession.serviceStatus, 'DOWN');
  assert.equal(expiredSession.reasonCode, 'BNG_UNREACHABLE');

  const openMappingsAfterFailure = await prisma.cgnatMapping.findMany({
    where: {
      sessionId: sessionCreate.body.session_id,
      timestampEnd: null,
    },
  });
  assert.equal(openMappingsAfterFailure.length, 0);

  const recoverBngRes = await request(app).patch(`/api/devices/${bngRes.body.id}/override`).send({
    admin_override_status: 'UP',
  });
  assert.equal(recoverBngRes.status, 200);

  const recoveredSession = await prisma.subscriberSession.findUnique({
    where: { id: sessionCreate.body.session_id },
  });
  assert.ok(recoveredSession);
  assert.equal(recoveredSession.state, 'ACTIVE');
  assert.equal(recoveredSession.serviceStatus, 'UP');
  assert.equal(recoveredSession.reasonCode, null);
  assert.ok(recoveredSession.leaseStart instanceof Date);
  assert.ok(recoveredSession.leaseExpires instanceof Date);
  assert.ok(recoveredSession.leaseExpires.getTime() > recoveredSession.leaseStart.getTime());

  const openMappingsAfterRecovery = await prisma.cgnatMapping.findMany({
    where: {
      sessionId: sessionCreate.body.session_id,
      timestampEnd: null,
    },
  });
  assert.equal(openMappingsAfterRecovery.length, 1);

  const invalidBngRes = await request(app).post('/api/sessions').send({
    interfaceId: ontMgmt.id,
    bngDeviceId: oltRes.body.id,
    serviceType: 'INTERNET',
    protocol: 'DHCP',
    macAddress: '02:55:4e:aa:bb:cd',
  });
  assert.equal(invalidBngRes.status, 422);
  assert.equal(invalidBngRes.body.error.code, 'BNG_UNREACHABLE');
});

test('Traffic gating requires ACTIVE subscriber sessions before ONT traffic is generated', async () => {
  const bngRes = await request(app).post('/api/devices').send({
    name: 'BNG-GATING-1',
    type: 'EDGE_ROUTER',
    x: 120,
    y: 80,
  });
  assert.equal(bngRes.status, 201);

  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-GATING-1',
    type: 'OLT',
    x: 60,
    y: 20,
  });
  assert.equal(oltRes.status, 201);

  const splitterRes = await request(app).post('/api/devices').send({
    name: 'SPLITTER-GATING-1',
    type: 'SPLITTER',
    x: 180,
    y: 120,
  });
  assert.equal(splitterRes.status, 201);

  const ontRes = await request(app).post('/api/devices').send({
    name: 'ONT-GATING-1',
    type: 'ONT',
    x: 260,
    y: 140,
  });
  assert.equal(ontRes.status, 201);

  const bngUpRes = await request(app).patch(`/api/devices/${bngRes.body.id}/override`).send({
    admin_override_status: 'UP',
  });
  assert.equal(bngUpRes.status, 200);

  const oltUpRes = await request(app).patch(`/api/devices/${oltRes.body.id}/override`).send({
    admin_override_status: 'UP',
  });
  assert.equal(oltUpRes.status, 200);

  const splitterUpRes = await request(app).patch(`/api/devices/${splitterRes.body.id}/override`).send({
    admin_override_status: 'UP',
  });
  assert.equal(splitterUpRes.status, 200);

  const bngAccess = bngRes.body.ports.find((port: any) => port.portType === 'ACCESS');
  const oltUplink = oltRes.body.ports.find((port: any) => port.portType === 'UPLINK');
  const oltPon = oltRes.body.ports.find((port: any) => port.portType === 'PON');
  const splitterIn = splitterRes.body.ports.find((port: any) => port.portType === 'IN');
  const splitterOut = splitterRes.body.ports.find((port: any) => port.portType === 'OUT');
  const ontPon = ontRes.body.ports.find((port: any) => port.portType === 'PON');
  assert.ok(bngAccess?.id);
  assert.ok(oltUplink?.id);
  assert.ok(oltPon?.id);
  assert.ok(splitterIn?.id);
  assert.ok(splitterOut?.id);
  assert.ok(ontPon?.id);

  const uplink = await request(app).post('/api/links').send({
    a_interface_id: bngAccess.id,
    b_interface_id: oltUplink.id,
    length_km: 1.1,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(uplink.status, 201);

  const feeder = await request(app).post('/api/links').send({
    a_interface_id: oltPon.id,
    b_interface_id: splitterIn.id,
    length_km: 0.8,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(feeder.status, 201);

  const access = await request(app).post('/api/links').send({
    a_interface_id: splitterOut.id,
    b_interface_id: ontPon.id,
    length_km: 0.2,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(access.status, 201);

  const ontProvision = await request(app).post(`/api/devices/${ontRes.body.id}/provision`).send({});
  assert.equal(ontProvision.status, 200);

  const ontUpRes = await request(app).patch(`/api/devices/${ontRes.body.id}/override`).send({
    admin_override_status: 'UP',
  });
  assert.equal(ontUpRes.status, 200);

  const ontMgmt = await prisma.interface.findUnique({
    where: {
      deviceId_name: {
        deviceId: ontRes.body.id,
        name: 'mgmt0',
      },
    },
  });
  assert.ok(ontMgmt);

  await runTrafficSimulationTick();

  const emptyTrafficSnapshot = await request(app).get('/api/metrics/snapshot');
  assert.equal(emptyTrafficSnapshot.status, 200);
  const emptyOntMetric = emptyTrafficSnapshot.body.devices.find((item: any) => item.id === ontRes.body.id);
  const emptyOltMetric = emptyTrafficSnapshot.body.devices.find((item: any) => item.id === oltRes.body.id);
  assert.ok(emptyOntMetric);
  assert.ok(emptyOltMetric);
  assert.equal(emptyOntMetric.trafficMbps, 0);
  assert.equal(emptyOntMetric.trafficProfile.internet_mbps, 0);
  assert.equal(emptyOltMetric.trafficMbps, 0);

  const sessionCreate = await request(app).post('/api/sessions').send({
    interfaceId: ontMgmt.id,
    bngDeviceId: bngRes.body.id,
    serviceType: 'INTERNET',
    protocol: 'DHCP',
    macAddress: '02:55:4e:aa:cc:01',
  });
  assert.equal(sessionCreate.status, 201);

  const vlanMappingRes = await request(app).post(`/api/devices/${oltRes.body.id}/vlan-mappings`).send({
    cTag: 100,
    sTag: 1010,
    serviceType: 'INTERNET',
  });
  assert.equal(vlanMappingRes.status, 201);

  const activateRes = await request(app).patch(`/api/sessions/${sessionCreate.body.session_id}`).send({
    state: 'ACTIVE',
  });
  assert.equal(activateRes.status, 200);

  await runTrafficSimulationTick();

  const activeTrafficSnapshot = await request(app).get('/api/metrics/snapshot');
  assert.equal(activeTrafficSnapshot.status, 200);
  const activeOntMetric = activeTrafficSnapshot.body.devices.find((item: any) => item.id === ontRes.body.id);
  const activeOltMetric = activeTrafficSnapshot.body.devices.find((item: any) => item.id === oltRes.body.id);
  assert.ok(activeOntMetric);
  assert.ok(activeOltMetric);
  assert.equal(activeOntMetric.status, 'UP');
  assert.equal(activeOltMetric.status, 'UP');
  assert.ok(activeOntMetric.trafficMbps > 0);
  assert.ok(activeOntMetric.trafficProfile.internet_mbps > 0);
  assert.equal(activeOntMetric.trafficProfile.voice_mbps, 0);
  assert.equal(activeOntMetric.trafficProfile.iptv_mbps, 0);
  assert.equal(activeOntMetric.segmentId, `${oltRes.body.id}:${splitterRes.body.id}`);
  assert.ok(activeOltMetric.trafficMbps >= activeOntMetric.trafficMbps);

  const blockedUplinkRes = await request(app).patch(`/api/links/${uplink.body.id}/override`).send({
    admin_override_status: 'DOWN',
  });
  assert.equal(blockedUplinkRes.status, 200);

  await runTrafficSimulationTick();

  const blockedTrafficSnapshot = await request(app).get('/api/metrics/snapshot');
  assert.equal(blockedTrafficSnapshot.status, 200);
  const blockedOntMetric = blockedTrafficSnapshot.body.devices.find((item: any) => item.id === ontRes.body.id);
  const blockedOltMetric = blockedTrafficSnapshot.body.devices.find((item: any) => item.id === oltRes.body.id);
  assert.ok(blockedOntMetric);
  assert.ok(blockedOltMetric);
  assert.equal(blockedOntMetric.trafficMbps, 0);
  assert.equal(blockedOntMetric.trafficProfile.internet_mbps, 0);
  assert.equal(blockedOntMetric.status, activeOntMetric.status);
  assert.equal(blockedOltMetric.trafficMbps, 0);
  assert.equal(blockedOltMetric.status, activeOltMetric.status);
});

test('GPON segment identity is reproducible per OLT and first passive aggregation', async () => {
  const bngRes = await request(app).post('/api/devices').send({
    name: 'BNG-SEGMENT-1',
    type: 'EDGE_ROUTER',
    x: 40,
    y: 40,
  });
  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-SEGMENT-1',
    type: 'OLT',
    x: 120,
    y: 40,
  });
  const splitterARes = await request(app).post('/api/devices').send({
    name: 'SPLITTER-SEGMENT-A',
    type: 'SPLITTER',
    x: 220,
    y: 20,
  });
  const splitterBRes = await request(app).post('/api/devices').send({
    name: 'SPLITTER-SEGMENT-B',
    type: 'SPLITTER',
    x: 220,
    y: 140,
  });
  const ontARes = await request(app).post('/api/devices').send({
    name: 'ONT-SEGMENT-A',
    type: 'ONT',
    x: 340,
    y: 20,
  });
  const ontBRes = await request(app).post('/api/devices').send({
    name: 'ONT-SEGMENT-B',
    type: 'ONT',
    x: 340,
    y: 140,
  });

  await request(app).patch(`/api/devices/${bngRes.body.id}/override`).send({ admin_override_status: 'UP' });
  await request(app).patch(`/api/devices/${oltRes.body.id}/override`).send({ admin_override_status: 'UP' });
  await request(app).patch(`/api/devices/${splitterARes.body.id}/override`).send({ admin_override_status: 'UP' });
  await request(app).patch(`/api/devices/${splitterBRes.body.id}/override`).send({ admin_override_status: 'UP' });

  const bngAccess = bngRes.body.ports.find((port: any) => port.portType === 'ACCESS');
  const oltUplink = oltRes.body.ports.find((port: any) => port.portType === 'UPLINK');
  const oltPonPorts = oltRes.body.ports.filter((port: any) => port.portType === 'PON');
  const splitterAIn = splitterARes.body.ports.find((port: any) => port.portType === 'IN');
  const splitterBIn = splitterBRes.body.ports.find((port: any) => port.portType === 'IN');
  const splitterAOut = splitterARes.body.ports.find((port: any) => port.portType === 'OUT');
  const splitterBOut = splitterBRes.body.ports.find((port: any) => port.portType === 'OUT');
  const ontAPon = ontARes.body.ports.find((port: any) => port.portType === 'PON');
  const ontBPon = ontBRes.body.ports.find((port: any) => port.portType === 'PON');

  assert.ok(bngAccess?.id);
  assert.ok(oltUplink?.id);
  assert.equal(oltPonPorts.length, 4);
  assert.ok(splitterAIn?.id);
  assert.ok(splitterBIn?.id);
  assert.ok(splitterAOut?.id);
  assert.ok(splitterBOut?.id);
  assert.ok(ontAPon?.id);
  assert.ok(ontBPon?.id);

  assert.equal(
    (await request(app).post('/api/links').send({
      a_interface_id: bngAccess.id,
      b_interface_id: oltUplink.id,
      length_km: 1,
      physical_medium_id: 'G.652.D',
    })).status,
    201
  );
  assert.equal(
    (await request(app).post('/api/links').send({
      a_interface_id: oltPonPorts[0].id,
      b_interface_id: splitterAIn.id,
      length_km: 0.5,
      physical_medium_id: 'G.652.D',
    })).status,
    201
  );
  assert.equal(
    (await request(app).post('/api/links').send({
      a_interface_id: oltPonPorts[1].id,
      b_interface_id: splitterBIn.id,
      length_km: 0.7,
      physical_medium_id: 'G.652.D',
    })).status,
    201
  );
  assert.equal(
    (await request(app).post('/api/links').send({
      a_interface_id: splitterAOut.id,
      b_interface_id: ontAPon.id,
      length_km: 0.15,
      physical_medium_id: 'G.652.D',
    })).status,
    201
  );
  assert.equal(
    (await request(app).post('/api/links').send({
      a_interface_id: splitterBOut.id,
      b_interface_id: ontBPon.id,
      length_km: 0.15,
      physical_medium_id: 'G.652.D',
    })).status,
    201
  );

  for (const ontId of [ontARes.body.id, ontBRes.body.id]) {
    const provisionRes = await request(app).post(`/api/devices/${ontId}/provision`).send({});
    assert.equal(provisionRes.status, 200);
    await request(app).patch(`/api/devices/${ontId}/override`).send({ admin_override_status: 'UP' });
  }

  const vlanMappingRes = await request(app).post(`/api/devices/${oltRes.body.id}/vlan-mappings`).send({
    cTag: 100,
    sTag: 1010,
    serviceType: 'INTERNET',
  });
  assert.equal(vlanMappingRes.status, 201);

  const ontAMgmt = await prisma.interface.findUnique({
    where: { deviceId_name: { deviceId: ontARes.body.id, name: 'mgmt0' } },
  });
  const ontBMgmt = await prisma.interface.findUnique({
    where: { deviceId_name: { deviceId: ontBRes.body.id, name: 'mgmt0' } },
  });
  assert.ok(ontAMgmt);
  assert.ok(ontBMgmt);

  const sessionA = await request(app).post('/api/sessions').send({
    interfaceId: ontAMgmt.id,
    bngDeviceId: bngRes.body.id,
    serviceType: 'INTERNET',
    protocol: 'DHCP',
    macAddress: '02:55:4e:11:11:01',
  });
  const sessionB = await request(app).post('/api/sessions').send({
    interfaceId: ontBMgmt.id,
    bngDeviceId: bngRes.body.id,
    serviceType: 'INTERNET',
    protocol: 'DHCP',
    macAddress: '02:55:4e:11:11:02',
  });
  assert.equal(sessionA.status, 201);
  assert.equal(sessionB.status, 201);

  assert.equal((await request(app).patch(`/api/sessions/${sessionA.body.session_id}`).send({ state: 'ACTIVE' })).status, 200);
  assert.equal((await request(app).patch(`/api/sessions/${sessionB.body.session_id}`).send({ state: 'ACTIVE' })).status, 200);

  await runTrafficSimulationTick();

  const metricsRes = await request(app).get('/api/metrics/snapshot');
  assert.equal(metricsRes.status, 200);

  const ontAMetric = metricsRes.body.devices.find((item: any) => item.id === ontARes.body.id);
  const ontBMetric = metricsRes.body.devices.find((item: any) => item.id === ontBRes.body.id);
  assert.ok(ontAMetric);
  assert.ok(ontBMetric);
  assert.equal(ontAMetric.segmentId, `${oltRes.body.id}:${splitterARes.body.id}`);
  assert.equal(ontBMetric.segmentId, `${oltRes.body.id}:${splitterBRes.body.id}`);
  assert.notEqual(ontAMetric.segmentId, ontBMetric.segmentId);
});

test('Device diagnostics expose upstream viability, chain, and stable reason codes', async () => {
  const bngRes = await request(app).post('/api/devices').send({
    name: 'BNG-DIAG-1',
    type: 'EDGE_ROUTER',
    x: 120,
    y: 80,
  });
  assert.equal(bngRes.status, 201);

  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-DIAG-1',
    type: 'OLT',
    x: 60,
    y: 20,
  });
  assert.equal(oltRes.status, 201);

  const splitterRes = await request(app).post('/api/devices').send({
    name: 'SPLITTER-DIAG-1',
    type: 'SPLITTER',
    x: 180,
    y: 120,
  });
  assert.equal(splitterRes.status, 201);

  const ontRes = await request(app).post('/api/devices').send({
    name: 'ONT-DIAG-1',
    type: 'ONT',
    x: 260,
    y: 140,
  });
  assert.equal(ontRes.status, 201);

  const bngAccess = bngRes.body.ports.find((port: any) => port.portType === 'ACCESS');
  const oltUplink = oltRes.body.ports.find((port: any) => port.portType === 'UPLINK');
  const oltPon = oltRes.body.ports.find((port: any) => port.portType === 'PON');
  const splitterIn = splitterRes.body.ports.find((port: any) => port.portType === 'IN');
  const splitterOut = splitterRes.body.ports.find((port: any) => port.portType === 'OUT');
  const ontPon = ontRes.body.ports.find((port: any) => port.portType === 'PON');
  assert.ok(bngAccess?.id);
  assert.ok(oltUplink?.id);
  assert.ok(oltPon?.id);
  assert.ok(splitterIn?.id);
  assert.ok(splitterOut?.id);
  assert.ok(ontPon?.id);

  assert.equal(
    (await request(app).patch(`/api/devices/${bngRes.body.id}/override`).send({ admin_override_status: 'UP' })).status,
    200
  );
  assert.equal(
    (await request(app).patch(`/api/devices/${oltRes.body.id}/override`).send({ admin_override_status: 'UP' })).status,
    200
  );
  assert.equal(
    (await request(app).patch(`/api/devices/${splitterRes.body.id}/override`).send({ admin_override_status: 'UP' })).status,
    200
  );
  assert.equal(
    (await request(app).patch(`/api/devices/${ontRes.body.id}/override`).send({ admin_override_status: 'UP' })).status,
    200
  );

  assert.equal((await request(app).post(`/api/devices/${bngRes.body.id}/provision`).send({})).status, 200);
  assert.equal((await request(app).post(`/api/devices/${oltRes.body.id}/provision`).send({})).status, 200);

  assert.equal(
    (
      await request(app).post('/api/links').send({
        a_interface_id: bngAccess.id,
        b_interface_id: oltUplink.id,
      })
    ).status,
    201
  );
  assert.equal(
    (
      await request(app).post('/api/links').send({
        a_interface_id: oltPon.id,
        b_interface_id: splitterIn.id,
      })
    ).status,
    201
  );
  assert.equal(
    (
      await request(app).post('/api/links').send({
        a_interface_id: splitterOut.id,
        b_interface_id: ontPon.id,
      })
    ).status,
    201
  );

  assert.equal((await request(app).post(`/api/devices/${ontRes.body.id}/provision`).send({})).status, 200);

  const healthyDiagRes = await request(app).get(`/api/devices/${ontRes.body.id}/diagnostics`);
  assert.equal(healthyDiagRes.status, 200);
  assert.equal(healthyDiagRes.body.device_id, ontRes.body.id);
  assert.equal(healthyDiagRes.body.upstream_l3_ok, true);
  assert.deepEqual(healthyDiagRes.body.reason_codes, []);
  assert.equal(healthyDiagRes.body.chain[0], ontRes.body.id);
  assert.ok(healthyDiagRes.body.chain.includes(oltRes.body.id));
  assert.ok(healthyDiagRes.body.chain.includes(bngRes.body.id));

  const blockedBngRes = await request(app).patch(`/api/devices/${bngRes.body.id}/override`).send({
    admin_override_status: 'DOWN',
  });
  assert.equal(blockedBngRes.status, 200);

  const blockedDiagRes = await request(app).get(`/api/devices/${ontRes.body.id}/diagnostics`);
  assert.equal(blockedDiagRes.status, 200);
  assert.equal(blockedDiagRes.body.upstream_l3_ok, false);
  assert.ok(blockedDiagRes.body.reason_codes.includes('no_router_path'));
});

test('Passive inline devices stay UP when upstream is valid but no downstream terminator exists yet', async () => {
  const bngRes = await request(app).post('/api/devices').send({
    name: 'BNG-PASSIVE-1',
    type: 'EDGE_ROUTER',
    x: 20,
    y: 20,
  });
  assert.equal(bngRes.status, 201);

  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-PASSIVE-1',
    type: 'OLT',
    x: 80,
    y: 80,
  });
  assert.equal(oltRes.status, 201);

  const splitterRes = await request(app).post('/api/devices').send({
    name: 'SPLITTER-PASSIVE-1',
    type: 'SPLITTER',
    x: 140,
    y: 140,
  });
  assert.equal(splitterRes.status, 201);

  const bngAccess = bngRes.body.ports.find((port: any) => port.portType === 'ACCESS');
  const oltUplink = oltRes.body.ports.find((port: any) => port.portType === 'UPLINK');
  const oltPon = oltRes.body.ports.find((port: any) => port.portType === 'PON');
  const splitterIn = splitterRes.body.ports.find((port: any) => port.portType === 'IN');
  assert.ok(bngAccess?.id);
  assert.ok(oltUplink?.id);
  assert.ok(oltPon?.id);
  assert.ok(splitterIn?.id);

  assert.equal((await request(app).post(`/api/devices/${bngRes.body.id}/provision`).send({})).status, 200);
  assert.equal((await request(app).post(`/api/devices/${oltRes.body.id}/provision`).send({})).status, 200);
  assert.equal((await request(app).patch(`/api/devices/${bngRes.body.id}/override`).send({ admin_override_status: 'UP' })).status, 200);
  assert.equal((await request(app).patch(`/api/devices/${oltRes.body.id}/override`).send({ admin_override_status: 'UP' })).status, 200);

  assert.equal(
    (
      await request(app).post('/api/links').send({
        a_interface_id: bngAccess.id,
        b_interface_id: oltUplink.id,
      })
    ).status,
    201
  );
  assert.equal(
    (
      await request(app).post('/api/links').send({
        a_interface_id: oltPon.id,
        b_interface_id: splitterIn.id,
      })
    ).status,
    201
  );

  await runTrafficSimulationTick();

  const metricsSnapshot = await request(app).get('/api/metrics/snapshot');
  assert.equal(metricsSnapshot.status, 200);
  const splitterMetric = metricsSnapshot.body.devices.find((item: any) => item.id === splitterRes.body.id);
  assert.ok(splitterMetric);
  assert.equal(splitterMetric.status, 'UP');

  const topologyRes = await request(app).get('/api/topology');
  assert.equal(topologyRes.status, 200);
  const splitterNode = topologyRes.body.nodes.find((node: any) => node.id === splitterRes.body.id);
  assert.ok(splitterNode);
  assert.equal(splitterNode.data.status, 'UP');

  const deviceListRes = await request(app).get('/api/devices');
  assert.equal(deviceListRes.status, 200);
  const splitterListItem = deviceListRes.body.find((item: any) => item.id === splitterRes.body.id);
  assert.ok(splitterListItem);
  assert.equal(splitterListItem.status, 'UP');

  const splitterDeviceRes = await request(app).get(`/api/devices/${splitterRes.body.id}`);
  assert.equal(splitterDeviceRes.status, 200);
  assert.equal(splitterDeviceRes.body.status, 'UP');

  const splitterDiagRes = await request(app).get(`/api/devices/${splitterRes.body.id}/diagnostics`);
  assert.equal(splitterDiagRes.status, 200);
  assert.equal(splitterDiagRes.body.upstream_l3_ok, false);
  assert.ok(splitterDiagRes.body.reason_codes.includes('no_downstream_terminator'));
  assert.ok(!splitterDiagRes.body.reason_codes.includes('no_router_path'));
});

test('Status evaluator keeps always-online classes UP by baseline until an explicit override says otherwise', async () => {
  const popRes = await request(app).post('/api/devices').send({
    name: 'POP-STATUS-1',
    type: 'POP',
    x: 10,
    y: 10,
  });
  assert.equal(popRes.status, 201);

  const coreSiteRes = await request(app).post('/api/devices').send({
    name: 'CORE-SITE-STATUS-1',
    type: 'CORE_SITE',
    x: 30,
    y: 30,
  });
  assert.equal(coreSiteRes.status, 201);

  const popDeviceRes = await request(app).get(`/api/devices/${popRes.body.id}`);
  assert.equal(popDeviceRes.status, 200);
  assert.equal(popDeviceRes.body.status, 'UP');

  const coreSiteDeviceRes = await request(app).get(`/api/devices/${coreSiteRes.body.id}`);
  assert.equal(coreSiteDeviceRes.status, 200);
  assert.equal(coreSiteDeviceRes.body.status, 'UP');

  const topologyRes = await request(app).get('/api/topology');
  assert.equal(topologyRes.status, 200);
  const popNode = topologyRes.body.nodes.find((node: any) => node.id === popRes.body.id);
  const coreSiteNode = topologyRes.body.nodes.find((node: any) => node.id === coreSiteRes.body.id);
  assert.ok(popNode);
  assert.ok(coreSiteNode);
  assert.equal(popNode.data.status, 'UP');
  assert.equal(coreSiteNode.data.status, 'UP');
});

test('Explicit device override remains authoritative over always-online baseline and diagnostics reasons stay stable', async () => {
  const popRes = await request(app).post('/api/devices').send({
    name: 'POP-OVERRIDE-1',
    type: 'POP',
    x: 15,
    y: 15,
  });
  assert.equal(popRes.status, 201);

  const overrideRes = await request(app).patch(`/api/devices/${popRes.body.id}/override`).send({
    admin_override_status: 'DOWN',
  });
  assert.equal(overrideRes.status, 200);
  assert.equal(overrideRes.body.status, 'DOWN');

  const popDeviceRes = await request(app).get(`/api/devices/${popRes.body.id}`);
  assert.equal(popDeviceRes.status, 200);
  assert.equal(popDeviceRes.body.status, 'DOWN');

  const popDiagRes = await request(app).get(`/api/devices/${popRes.body.id}/diagnostics`);
  assert.equal(popDiagRes.status, 200);
  assert.equal(popDiagRes.body.upstream_l3_ok, false);
  assert.ok(popDiagRes.body.reason_codes.includes('device_not_passable'));
});

test('Unprovisioned isolated strict classes keep stable reason codes in diagnostics', async () => {
  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-STRICT-1',
    type: 'OLT',
    x: 50,
    y: 50,
  });
  assert.equal(oltRes.status, 201);

  const oltDeviceRes = await request(app).get(`/api/devices/${oltRes.body.id}`);
  assert.equal(oltDeviceRes.status, 200);
  assert.equal(oltDeviceRes.body.status, 'DOWN');

  const oltDiagRes = await request(app).get(`/api/devices/${oltRes.body.id}/diagnostics`);
  assert.equal(oltDiagRes.status, 200);
  assert.equal(oltDiagRes.body.upstream_l3_ok, false);
  assert.ok(oltDiagRes.body.reason_codes.includes('not_provisioned'));
  assert.ok(oltDiagRes.body.reason_codes.includes('device_not_in_graph'));
});

test('Downstream pre-order clamp preserves strict-priority traffic and caps best-effort to GPON budget', () => {
  const clamped = clampDownstreamDemands([
    {
      deviceId: 'leaf-a',
      segmentId: 'olt-1',
      voiceMbps: 0.1,
      iptvMbps: 10,
      internetMbps: 1800,
    },
    {
      deviceId: 'leaf-b',
      segmentId: 'olt-1',
      voiceMbps: 0.1,
      iptvMbps: 10,
      internetMbps: 1600,
    },
  ]);

  const leafA = clamped.get('leaf-a');
  const leafB = clamped.get('leaf-b');
  assert.ok(leafA);
  assert.ok(leafB);
  assert.equal(leafA.voiceMbps, 0.1);
  assert.equal(leafB.voiceMbps, 0.1);
  assert.equal(leafA.iptvMbps, 10);
  assert.equal(leafB.iptvMbps, 10);
  assert.ok(leafA.internetMbps < 1800);
  assert.ok(leafB.internetMbps < 1600);

  const aggregateTotal = Number((leafA.totalMbps + leafB.totalMbps).toFixed(2));
  const aggregateInternet = Number((leafA.internetMbps + leafB.internetMbps).toFixed(2));
  assert.ok(aggregateTotal <= 2500);
  assert.ok(aggregateInternet > 0);
  assert.equal(aggregateInternet, 2479.8);
});

test('GPON congestion uses 95/85 hysteresis and emits stable segment events with OLT context', async () => {
  if (!httpServer.listening) {
    await new Promise<void>((resolve, reject) => {
      httpServer.listen(0, '127.0.0.1', (error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  const bngRes = await request(app).post('/api/devices').send({
    name: 'BNG-CONGEST-1',
    type: 'EDGE_ROUTER',
    x: 40,
    y: 40,
  });
  assert.equal(bngRes.status, 201);

  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-CONGEST-1',
    type: 'OLT',
    x: 120,
    y: 60,
  });
  assert.equal(oltRes.status, 201);

  await request(app).patch(`/api/devices/${bngRes.body.id}/override`).send({ admin_override_status: 'UP' });
  await request(app).patch(`/api/devices/${oltRes.body.id}/override`).send({ admin_override_status: 'UP' });

  const bngAccess = bngRes.body.ports.find((port: any) => port.portType === 'ACCESS');
  const oltUplink = oltRes.body.ports.find((port: any) => port.portType === 'UPLINK');
  assert.ok(bngAccess?.id);
  assert.ok(oltUplink?.id);

  const uplink = await request(app).post('/api/links').send({
    a_interface_id: bngAccess.id,
    b_interface_id: oltUplink.id,
    length_km: 1,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(uplink.status, 201);

  const oltPonPorts = oltRes.body.ports.filter((port: any) => port.portType === 'PON');
  assert.equal(oltPonPorts.length, 4);

  const rootSplitterRes = await request(app).post('/api/devices').send({
    name: 'SPLITTER-CONGEST-ROOT',
    type: 'SPLITTER',
    x: 200,
    y: 260,
  });
  assert.equal(rootSplitterRes.status, 201);

  await request(app)
    .patch(`/api/devices/${rootSplitterRes.body.id}/override`)
    .send({ admin_override_status: 'UP' });

  const rootSplitterIn = rootSplitterRes.body.ports.find((port: any) => port.portType === 'IN');
  const rootSplitterOutPorts = rootSplitterRes.body.ports.filter((port: any) => port.portType === 'OUT');
  assert.ok(rootSplitterIn?.id);
  assert.equal(rootSplitterOutPorts.length, 8);

  const rootFeeder = await request(app).post('/api/links').send({
    a_interface_id: oltPonPorts[0].id,
    b_interface_id: rootSplitterIn.id,
    length_km: 0.4,
    physical_medium_id: 'G.652.D',
  });
  assert.equal(rootFeeder.status, 201);

  const splitterIds: string[] = [];
  const activeOntIds: string[] = [];
  const sessionsByOntId = new Map<string, string>();

  for (let splitterIndex = 0; splitterIndex < 4; splitterIndex += 1) {
    const splitterRes = await request(app).post('/api/devices').send({
      name: `SPLITTER-CONGEST-${splitterIndex + 1}`,
      type: 'SPLITTER',
      x: 220,
      y: 100 + splitterIndex * 120,
    });
    assert.equal(splitterRes.status, 201);
    splitterIds.push(splitterRes.body.id);

    await request(app)
      .patch(`/api/devices/${splitterRes.body.id}/override`)
      .send({ admin_override_status: 'UP' });

    const splitterIn = splitterRes.body.ports.find((port: any) => port.portType === 'IN');
    const splitterOutPorts = splitterRes.body.ports.filter((port: any) => port.portType === 'OUT');
    assert.ok(splitterIn?.id);
    assert.equal(splitterOutPorts.length, 8);

    const feeder = await request(app).post('/api/links').send({
      a_interface_id: rootSplitterOutPorts[splitterIndex].id,
      b_interface_id: splitterIn.id,
      length_km: 0.4 + splitterIndex * 0.1,
      physical_medium_id: 'G.652.D',
    });
    assert.equal(feeder.status, 201);

    for (let outputIndex = 0; outputIndex < splitterOutPorts.length; outputIndex += 1) {
      const ontRes = await request(app).post('/api/devices').send({
        name: `ONT-CONGEST-${splitterIndex + 1}-${outputIndex + 1}`,
        type: 'ONT',
        x: 340,
        y: 80 + splitterIndex * 120 + outputIndex * 20,
      });
      assert.equal(ontRes.status, 201);
      activeOntIds.push(ontRes.body.id);

      const ontPon = ontRes.body.ports.find((port: any) => port.portType === 'PON');
      assert.ok(ontPon?.id);

      const access = await request(app).post('/api/links').send({
        a_interface_id: splitterOutPorts[outputIndex].id,
        b_interface_id: ontPon.id,
        length_km: 0.15,
        physical_medium_id: 'G.652.D',
      });
      assert.equal(access.status, 201);

      const ontProvision = await request(app).post(`/api/devices/${ontRes.body.id}/provision`).send({});
      assert.equal(ontProvision.status, 200);
      await request(app)
        .patch(`/api/devices/${ontRes.body.id}/override`)
        .send({ admin_override_status: 'UP' });

      const ontMgmt = await prisma.interface.findUnique({
        where: {
          deviceId_name: {
            deviceId: ontRes.body.id,
            name: 'mgmt0',
          },
        },
      });
      assert.ok(ontMgmt);

      const sessionCreate = await request(app).post('/api/sessions').send({
        interfaceId: ontMgmt.id,
        bngDeviceId: bngRes.body.id,
        serviceType: 'INTERNET',
        protocol: 'DHCP',
        macAddress: `02:55:4e:${String(splitterIndex).padStart(2, '0')}:${String(outputIndex).padStart(2, '0')}:01`,
      });
      assert.equal(sessionCreate.status, 201);
      sessionsByOntId.set(ontRes.body.id, sessionCreate.body.session_id);
    }
  }

  const vlanMappingRes = await request(app).post(`/api/devices/${oltRes.body.id}/vlan-mappings`).send({
    cTag: 100,
    sTag: 1010,
    serviceType: 'INTERNET',
  });
  assert.equal(vlanMappingRes.status, 201);

  for (const sessionId of sessionsByOntId.values()) {
    const activateRes = await request(app).patch(`/api/sessions/${sessionId}`).send({ state: 'ACTIVE' });
    assert.equal(activateRes.status, 200);
  }

  const address = httpServer.address();
  assert.ok(address && typeof address === 'object' && 'port' in address);

  const client = createSocketClient(`http://127.0.0.1:${address.port}`, {
    path: '/api/socket.io',
    transports: ['websocket'],
  });
  await once(client, 'connect');

  const received: Array<{ kind: string; payload: any }> = [];
  client.on('event', (envelope) => {
    received.push({ kind: envelope.kind, payload: envelope.payload });
  });

  await runTrafficSimulationTick();
  await new Promise((resolve) => setTimeout(resolve, 100));

  const firstDetected = received.filter((entry) => entry.kind === 'segmentCongestionDetected');
  const firstCleared = received.filter((entry) => entry.kind === 'segmentCongestionCleared');
  assert.equal(firstDetected.length, 1);
  assert.equal(firstCleared.length, 0);
  assert.equal(firstDetected[0].payload.segmentId, `${oltRes.body.id}:${rootSplitterRes.body.id}`);
  assert.equal(firstDetected[0].payload.oltId, oltRes.body.id);
  assert.ok(firstDetected[0].payload.utilization >= 0.95);
  assert.equal(typeof firstDetected[0].payload.tick, 'number');

  received.length = 0;
  await runTrafficSimulationTick();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(received.filter((entry) => entry.kind === 'segmentCongestionDetected').length, 0);
  assert.equal(received.filter((entry) => entry.kind === 'segmentCongestionCleared').length, 0);

  const remainingOntIds = new Set(activeOntIds.slice(0, 10));
  const sessionIdsToExpire = activeOntIds
    .filter((deviceId) => !remainingOntIds.has(deviceId))
    .map((deviceId) => sessionsByOntId.get(deviceId))
    .filter((sessionId): sessionId is string => Boolean(sessionId));

  await prisma.subscriberSession.updateMany({
    where: {
      id: {
        in: sessionIdsToExpire,
      },
    },
    data: {
      state: 'EXPIRED',
      serviceStatus: 'DOWN',
      reasonCode: 'TEST_CONGESTION_CLEAR',
    },
  });

  received.length = 0;
  await runTrafficSimulationTick();
  await new Promise((resolve) => setTimeout(resolve, 100));

  const clearEvents = received.filter((entry) => entry.kind === 'segmentCongestionCleared');
  assert.equal(clearEvents.length, 1);
  assert.equal(clearEvents[0].payload.segmentId, `${oltRes.body.id}:${rootSplitterRes.body.id}`);
  assert.equal(clearEvents[0].payload.oltId, oltRes.body.id);
  assert.ok(clearEvents[0].payload.utilization <= 0.85);
  assert.equal(typeof clearEvents[0].payload.tick, 'number');

  received.length = 0;
  await runTrafficSimulationTick();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(received.filter((entry) => entry.kind === 'segmentCongestionDetected').length, 0);
  assert.equal(received.filter((entry) => entry.kind === 'segmentCongestionCleared').length, 0);

  client.disconnect();
});

test('Forensics trace resolves CGNAT mapping back to subscriber session and device context', async () => {
  const bngRes = await request(app).post('/api/devices').send({
    name: 'BNG-FORENSICS-1',
    type: 'EDGE_ROUTER',
    x: 120,
    y: 80,
  });
  assert.equal(bngRes.status, 201);

  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-FORENSICS-1',
    type: 'OLT',
    x: 60,
    y: 20,
  });
  assert.equal(oltRes.status, 201);

  const splitterRes = await request(app).post('/api/devices').send({
    name: 'SPLITTER-FORENSICS-1',
    type: 'SPLITTER',
    x: 180,
    y: 120,
  });
  assert.equal(splitterRes.status, 201);

  const ontRes = await request(app).post('/api/devices').send({
    name: 'ONT-FORENSICS-1',
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

  assert.equal(
    (
      await request(app).post('/api/links').send({
        a_interface_id: oltPon.id,
        b_interface_id: splitterIn.id,
        length_km: 1.2,
        physical_medium_id: 'G.652.D',
      })
    ).status,
    201
  );
  assert.equal(
    (
      await request(app).post('/api/links').send({
        a_interface_id: splitterOut.id,
        b_interface_id: ontPon.id,
        length_km: 0.4,
        physical_medium_id: 'G.652.D',
      })
    ).status,
    201
  );

  assert.equal((await request(app).post(`/api/devices/${bngRes.body.id}/provision`).send({})).status, 200);
  assert.equal((await request(app).post(`/api/devices/${ontRes.body.id}/provision`).send({})).status, 200);

  const ontMgmt = await prisma.interface.findUnique({
    where: {
      deviceId_name: {
        deviceId: ontRes.body.id,
        name: 'mgmt0',
      },
    },
  });
  assert.ok(ontMgmt);

  const sessionCreate = await request(app).post('/api/sessions').send({
    interfaceId: ontMgmt.id,
    bngDeviceId: bngRes.body.id,
    serviceType: 'INTERNET',
    protocol: 'DHCP',
    macAddress: '02:55:4e:aa:dd:01',
  });
  assert.equal(sessionCreate.status, 201);

  const vlanMappingRes = await request(app).post(`/api/devices/${oltRes.body.id}/vlan-mappings`).send({
    cTag: 100,
    sTag: 1010,
    serviceType: 'INTERNET',
  });
  assert.equal(vlanMappingRes.status, 201);

  const activateRes = await request(app).patch(`/api/sessions/${sessionCreate.body.session_id}`).send({
    state: 'ACTIVE',
  });
  assert.equal(activateRes.status, 200);

  const mapping = await prisma.cgnatMapping.findFirst({
    where: { sessionId: sessionCreate.body.session_id },
    orderBy: { timestampStart: 'desc' },
  });
  assert.ok(mapping);
  assert.match(mapping.publicIp, /^198\.51\.100\.\d+$/);
  assert.ok(mapping.portRangeEnd >= mapping.portRangeStart);

  const traceTimestamp = new Date(mapping.timestampStart.getTime() + 1000).toISOString();
  const traceSuccess = await request(app)
    .get('/api/forensics/trace')
    .query({ ip: mapping.publicIp, port: mapping.portRangeStart, ts: traceTimestamp });
  assert.equal(traceSuccess.status, 200);
  assert.equal(traceSuccess.body.mapping.mapping_id, mapping.id);
  assert.equal(traceSuccess.body.session.session_id, sessionCreate.body.session_id);
  assert.equal(traceSuccess.body.device.id, ontRes.body.id);
  assert.equal(traceSuccess.body.device.type, 'ONT');
  assert.equal(traceSuccess.body.topology.olt_id, oltRes.body.id);
  assert.equal(traceSuccess.body.topology.bng_id, bngRes.body.id);
  assert.equal(traceSuccess.body.mapping.public_ip, mapping.publicIp);
  assert.equal(traceSuccess.body.mapping.private_ip, mapping.privateIp);

  const traceFail = await request(app)
    .get('/api/forensics/trace')
    .query({ ip: mapping.publicIp, port: mapping.portRangeEnd + 1, ts: traceTimestamp });
  assert.equal(traceFail.status, 404);
  assert.equal(traceFail.body.error.code, 'TRACE_NOT_FOUND');
});

test('Session listing supports unfiltered and device-scoped queries', async () => {
  const bngRes = await request(app).post('/api/devices').send({
    name: 'BNG-LIST-1',
    type: 'EDGE_ROUTER',
    x: 120,
    y: 80,
  });
  assert.equal(bngRes.status, 201);

  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-LIST-1',
    type: 'OLT',
    x: 60,
    y: 20,
  });
  assert.equal(oltRes.status, 201);

  const splitterRes = await request(app).post('/api/devices').send({
    name: 'SPLITTER-LIST-1',
    type: 'SPLITTER',
    x: 180,
    y: 120,
  });
  assert.equal(splitterRes.status, 201);

  const ontOneRes = await request(app).post('/api/devices').send({
    name: 'ONT-LIST-1',
    type: 'ONT',
    x: 260,
    y: 140,
  });
  assert.equal(ontOneRes.status, 201);

  const ontTwoRes = await request(app).post('/api/devices').send({
    name: 'ONT-LIST-2',
    type: 'ONT',
    x: 300,
    y: 160,
  });
  assert.equal(ontTwoRes.status, 201);

  const oltPon = oltRes.body.ports.find((port: any) => port.portType === 'PON');
  const splitterIn = splitterRes.body.ports.find((port: any) => port.portType === 'IN');
  const splitterOutPorts = splitterRes.body.ports.filter((port: any) => port.portType === 'OUT');
  const ontOnePon = ontOneRes.body.ports.find((port: any) => port.portType === 'PON');
  const ontTwoPon = ontTwoRes.body.ports.find((port: any) => port.portType === 'PON');
  assert.ok(oltPon?.id);
  assert.ok(splitterIn?.id);
  assert.ok(splitterOutPorts.length >= 2);
  assert.ok(ontOnePon?.id);
  assert.ok(ontTwoPon?.id);

  assert.equal(
    (
      await request(app).post('/api/links').send({
        a_interface_id: oltPon.id,
        b_interface_id: splitterIn.id,
        length_km: 1.0,
        physical_medium_id: 'G.652.D',
      })
    ).status,
    201
  );
  assert.equal(
    (
      await request(app).post('/api/links').send({
        a_interface_id: splitterOutPorts[0].id,
        b_interface_id: ontOnePon.id,
        length_km: 0.2,
        physical_medium_id: 'G.652.D',
      })
    ).status,
    201
  );
  assert.equal(
    (
      await request(app).post('/api/links').send({
        a_interface_id: splitterOutPorts[1].id,
        b_interface_id: ontTwoPon.id,
        length_km: 0.25,
        physical_medium_id: 'G.652.D',
      })
    ).status,
    201
  );

  assert.equal((await request(app).post(`/api/devices/${bngRes.body.id}/provision`).send({})).status, 200);
  assert.equal((await request(app).post(`/api/devices/${ontOneRes.body.id}/provision`).send({})).status, 200);
  assert.equal((await request(app).post(`/api/devices/${ontTwoRes.body.id}/provision`).send({})).status, 200);

  const [ontOneMgmt, ontTwoMgmt] = await Promise.all([
    prisma.interface.findUnique({
      where: {
        deviceId_name: {
          deviceId: ontOneRes.body.id,
          name: 'mgmt0',
        },
      },
    }),
    prisma.interface.findUnique({
      where: {
        deviceId_name: {
          deviceId: ontTwoRes.body.id,
          name: 'mgmt0',
        },
      },
    }),
  ]);
  assert.ok(ontOneMgmt);
  assert.ok(ontTwoMgmt);

  const sessionOne = await request(app).post('/api/sessions').send({
    interfaceId: ontOneMgmt.id,
    bngDeviceId: bngRes.body.id,
    serviceType: 'INTERNET',
    protocol: 'DHCP',
    macAddress: '02:55:4e:aa:ee:01',
  });
  const sessionTwo = await request(app).post('/api/sessions').send({
    interfaceId: ontTwoMgmt.id,
    bngDeviceId: bngRes.body.id,
    serviceType: 'IPTV',
    protocol: 'DHCP',
    macAddress: '02:55:4e:aa:ee:02',
  });
  assert.equal(sessionOne.status, 201);
  assert.equal(sessionTwo.status, 201);

  const allSessionsRes = await request(app).get('/api/sessions');
  assert.equal(allSessionsRes.status, 200);
  assert.equal(allSessionsRes.body.length, 2);

  const filteredByDeviceRes = await request(app).get('/api/sessions').query({ device_id: ontOneRes.body.id });
  assert.equal(filteredByDeviceRes.status, 200);
  assert.equal(filteredByDeviceRes.body.length, 1);
  assert.equal(filteredByDeviceRes.body[0].session_id, sessionOne.body.session_id);
  assert.equal(filteredByDeviceRes.body[0].device_id, ontOneRes.body.id);
});

test('Session listing enforces default pagination and exposes total count header', async () => {
  const bngRes = await request(app).post('/api/devices').send({
    name: 'BNG-PAGE-1',
    type: 'EDGE_ROUTER',
    x: 120,
    y: 80,
  });
  assert.equal(bngRes.status, 201);

  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-PAGE-1',
    type: 'OLT',
    x: 60,
    y: 20,
  });
  assert.equal(oltRes.status, 201);

  const splitterRes = await request(app).post('/api/devices').send({
    name: 'SPLITTER-PAGE-1',
    type: 'SPLITTER',
    x: 180,
    y: 120,
  });
  assert.equal(splitterRes.status, 201);

  const ontRes = await request(app).post('/api/devices').send({
    name: 'ONT-PAGE-1',
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

  assert.equal(
    (
      await request(app).post('/api/links').send({
        a_interface_id: oltPon.id,
        b_interface_id: splitterIn.id,
        length_km: 0.8,
        physical_medium_id: 'G.652.D',
      })
    ).status,
    201
  );
  assert.equal(
    (
      await request(app).post('/api/links').send({
        a_interface_id: splitterOut.id,
        b_interface_id: ontPon.id,
        length_km: 0.2,
        physical_medium_id: 'G.652.D',
      })
    ).status,
    201
  );

  assert.equal((await request(app).post(`/api/devices/${ontRes.body.id}/provision`).send({})).status, 200);

  const ontMgmt = await prisma.interface.findUnique({
    where: {
      deviceId_name: {
        deviceId: ontRes.body.id,
        name: 'mgmt0',
      },
    },
  });
  assert.ok(ontMgmt);

  await prisma.subscriberSession.createMany({
    data: Array.from({ length: 55 }, (_, index) => ({
      interfaceId: ontMgmt.id,
      bngDeviceId: bngRes.body.id,
      macAddress: `02:55:4e:ab:${String(Math.floor(index / 100)).padStart(2, '0')}:${String(index % 100).padStart(2, '0')}`.toLowerCase(),
      protocol: 'DHCP',
      serviceType: index % 2 === 0 ? 'INTERNET' : 'IPTV',
      state: 'INIT',
      infraStatus: 'UP',
      serviceStatus: 'DEGRADED',
      reasonCode: 'SESSION_NOT_ACTIVE',
    })),
  });

  const defaultListRes = await request(app).get('/api/sessions');
  assert.equal(defaultListRes.status, 200);
  assert.equal(defaultListRes.body.length, 50);
  assert.equal(defaultListRes.headers['x-total-count'], '55');

  const offsetListRes = await request(app).get('/api/sessions').query({ offset: 50 });
  assert.equal(offsetListRes.status, 200);
  assert.equal(offsetListRes.body.length, 5);
  assert.equal(offsetListRes.headers['x-total-count'], '55');
});

test('Forensics trace ignores mappings that expired before the requested timestamp', async () => {
  const bngRes = await request(app).post('/api/devices').send({
    name: 'BNG-TRACE-WINDOW-1',
    type: 'EDGE_ROUTER',
    x: 120,
    y: 80,
  });
  assert.equal(bngRes.status, 201);

  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-TRACE-WINDOW-1',
    type: 'OLT',
    x: 60,
    y: 20,
  });
  assert.equal(oltRes.status, 201);

  const splitterRes = await request(app).post('/api/devices').send({
    name: 'SPLITTER-TRACE-WINDOW-1',
    type: 'SPLITTER',
    x: 180,
    y: 120,
  });
  assert.equal(splitterRes.status, 201);

  const ontRes = await request(app).post('/api/devices').send({
    name: 'ONT-TRACE-WINDOW-1',
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

  assert.equal(
    (
      await request(app).post('/api/links').send({
        a_interface_id: oltPon.id,
        b_interface_id: splitterIn.id,
        length_km: 1.0,
        physical_medium_id: 'G.652.D',
      })
    ).status,
    201
  );
  assert.equal(
    (
      await request(app).post('/api/links').send({
        a_interface_id: splitterOut.id,
        b_interface_id: ontPon.id,
        length_km: 0.3,
        physical_medium_id: 'G.652.D',
      })
    ).status,
    201
  );

  assert.equal((await request(app).post(`/api/devices/${bngRes.body.id}/provision`).send({})).status, 200);
  assert.equal((await request(app).post(`/api/devices/${ontRes.body.id}/provision`).send({})).status, 200);

  const ontMgmt = await prisma.interface.findUnique({
    where: {
      deviceId_name: {
        deviceId: ontRes.body.id,
        name: 'mgmt0',
      },
    },
  });
  assert.ok(ontMgmt);

  const sessionCreate = await request(app).post('/api/sessions').send({
    interfaceId: ontMgmt.id,
    bngDeviceId: bngRes.body.id,
    serviceType: 'INTERNET',
    protocol: 'DHCP',
    macAddress: '02:55:4e:ac:01:01',
  });
  assert.equal(sessionCreate.status, 201);

  const vlanMappingRes = await request(app).post(`/api/devices/${oltRes.body.id}/vlan-mappings`).send({
    cTag: 100,
    sTag: 1010,
    serviceType: 'INTERNET',
  });
  assert.equal(vlanMappingRes.status, 201);

  const activateRes = await request(app).patch(`/api/sessions/${sessionCreate.body.session_id}`).send({
    state: 'ACTIVE',
  });
  assert.equal(activateRes.status, 200);

  const mapping = await prisma.cgnatMapping.findFirst({
    where: { sessionId: sessionCreate.body.session_id },
    orderBy: { timestampStart: 'desc' },
  });
  assert.ok(mapping);

  const expiredAt = new Date(mapping.timestampStart.getTime() + 1000);
  await prisma.cgnatMapping.update({
    where: { id: mapping.id },
    data: {
      timestampEnd: expiredAt,
    },
  });

  const traceAfterExpiryRes = await request(app)
    .get('/api/forensics/trace')
    .query({
      ip: mapping.publicIp,
      port: mapping.portRangeStart,
      ts: new Date(expiredAt.getTime() + 1000).toISOString(),
    });
  assert.equal(traceAfterExpiryRes.status, 404);
  assert.equal(traceAfterExpiryRes.body.error.code, 'TRACE_NOT_FOUND');
});

test('Traffic tick expires leased-out sessions before generating subscriber traffic', async () => {
  const oltRes = await request(app).post('/api/devices').send({
    name: 'OLT-LEASE',
    type: 'OLT',
    x: 100,
    y: 100,
  });
  assert.equal(oltRes.status, 201);

  const splitterRes = await request(app).post('/api/devices').send({
    name: 'SPLITTER-LEASE',
    type: 'SPLITTER',
    x: 150,
    y: 110,
  });
  assert.equal(splitterRes.status, 201);

  const ontRes = await request(app).post('/api/devices').send({
    name: 'ONT-LEASE',
    type: 'ONT',
    x: 190,
    y: 120,
  });
  assert.equal(ontRes.status, 201);

  const bngRes = await request(app).post('/api/devices').send({
    name: 'BNG-LEASE',
    type: 'EDGE_ROUTER',
    x: 20,
    y: 20,
  });
  assert.equal(bngRes.status, 201);

  const oltPon = oltRes.body.ports.find((port: any) => port.portType === 'PON');
  const splitterIn = splitterRes.body.ports.find((port: any) => port.portType === 'IN');
  const splitterOut = splitterRes.body.ports.find((port: any) => port.portType === 'OUT');
  const ontPon = ontRes.body.ports.find((port: any) => port.portType === 'PON');
  assert.ok(oltPon?.id);
  assert.ok(splitterIn?.id);
  assert.ok(splitterOut?.id);
  assert.ok(ontPon?.id);

  const feederRes = await request(app).post('/api/links').send({
    a_interface_id: oltPon.id,
    b_interface_id: splitterIn.id,
  });
  assert.equal(feederRes.status, 201);

  const accessRes = await request(app).post('/api/links').send({
    a_interface_id: splitterOut.id,
    b_interface_id: ontPon.id,
  });
  assert.equal(accessRes.status, 201);

  assert.equal((await request(app).post(`/api/devices/${oltRes.body.id}/provision`).send({})).status, 200);
  assert.equal((await request(app).post(`/api/devices/${ontRes.body.id}/provision`).send({})).status, 200);
  assert.equal((await request(app).post(`/api/devices/${bngRes.body.id}/provision`).send({})).status, 200);

  const ontMgmt = await prisma.interface.findUnique({
    where: {
      deviceId_name: {
        deviceId: ontRes.body.id,
        name: 'mgmt0',
      },
    },
  });
  assert.ok(ontMgmt);

  const sessionCreate = await request(app).post('/api/sessions').send({
    interfaceId: ontMgmt.id,
    bngDeviceId: bngRes.body.id,
    serviceType: 'INTERNET',
    protocol: 'DHCP',
    macAddress: '02:55:4e:ac:09:09',
  });
  assert.equal(sessionCreate.status, 201);

  const vlanMappingRes = await request(app).post(`/api/devices/${oltRes.body.id}/vlan-mappings`).send({
    cTag: 100,
    sTag: 1010,
    serviceType: 'INTERNET',
  });
  assert.equal(vlanMappingRes.status, 201);

  const activateRes = await request(app).patch(`/api/sessions/${sessionCreate.body.session_id}`).send({
    state: 'ACTIVE',
  });
  assert.equal(activateRes.status, 200);

  const pastLeaseExpiry = new Date(Date.now() - 5_000);
  await prisma.subscriberSession.update({
    where: { id: sessionCreate.body.session_id },
    data: {
      leaseExpires: pastLeaseExpiry,
    },
  });

  await runTrafficSimulationTick();

  const expiredSession = await prisma.subscriberSession.findUnique({
    where: { id: sessionCreate.body.session_id },
  });
  assert.ok(expiredSession);
  assert.equal(expiredSession.state, 'EXPIRED');
  assert.equal(expiredSession.serviceStatus, 'DOWN');
  assert.equal(expiredSession.reasonCode, 'SESSION_EXPIRED');

  const closedMapping = await prisma.cgnatMapping.findFirst({
    where: {
      sessionId: sessionCreate.body.session_id,
    },
    orderBy: { timestampStart: 'desc' },
  });
  assert.ok(closedMapping);
  assert.notEqual(closedMapping.timestampEnd, null);
  assert.ok(closedMapping.timestampEnd!.getTime() >= pastLeaseExpiry.getTime());
});
