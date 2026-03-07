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

const { app, prisma, stopTrafficLoop, resetSimulationState, runTrafficSimulationTick, clampDownstreamDemands } =
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
  const splitterIn = splitterRes.body.ports.find((port: any) => port.portType === 'IN');
  const splitterOut = splitterRes.body.ports.find((port: any) => port.portType === 'OUT');
  const ontPon = ontRes.body.ports.find((port: any) => port.portType === 'PON');
  assert.ok(oltPon?.id);
  assert.ok(splitterIn?.id);
  assert.ok(splitterOut?.id);
  assert.ok(ontPon?.id);

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

  const clearBngOverrideRes = await request(app).patch(`/api/devices/${bngRes.body.id}/override`).send({
    admin_override_status: null,
  });
  assert.equal(clearBngOverrideRes.status, 200);

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

  const oltPon = oltRes.body.ports.find((port: any) => port.portType === 'PON');
  const splitterIn = splitterRes.body.ports.find((port: any) => port.portType === 'IN');
  const splitterOut = splitterRes.body.ports.find((port: any) => port.portType === 'OUT');
  const ontPon = ontRes.body.ports.find((port: any) => port.portType === 'PON');
  assert.ok(oltPon?.id);
  assert.ok(splitterIn?.id);
  assert.ok(splitterOut?.id);
  assert.ok(ontPon?.id);

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
  assert.ok(activeOntMetric.trafficMbps > 0);
  assert.ok(activeOntMetric.trafficProfile.internet_mbps > 0);
  assert.equal(activeOntMetric.trafficProfile.voice_mbps, 0);
  assert.equal(activeOntMetric.trafficProfile.iptv_mbps, 0);
  assert.equal(activeOntMetric.segmentId, oltRes.body.id);
  assert.ok(activeOltMetric.trafficMbps >= activeOntMetric.trafficMbps);
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
