import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prismaDir = path.resolve(__dirname, '../prisma');
const seedDb = path.join(prismaDir, 'dev.db');
const testDb = path.join(prismaDir, 'test.db');

if (!fs.existsSync(testDb)) {
  fs.copyFileSync(seedDb, testDb);
}

process.env.DATABASE_URL = `file:${testDb}`;

const { app, prisma, stopTrafficLoop } = await import('../server.ts');

test.beforeEach(async () => {
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
    type: 'Splitter',
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
    sourcePortId: oltPonPort.id,
    targetPortId: onuPonPort.id,
  });
  assert.equal(directInvalidRes.status, 400);

  const feederRes = await request(app).post('/api/links').send({
    sourcePortId: oltPonPort.id,
    targetPortId: splitterIn.id,
  });
  assert.equal(feederRes.status, 201);

  const accessRes = await request(app).post('/api/links').send({
    sourcePortId: splitterOut.id,
    targetPortId: onuPonPort.id,
  });
  assert.equal(accessRes.status, 201);

  const topologyRes = await request(app).get('/api/topology');
  assert.equal(topologyRes.status, 200);
  assert.equal(topologyRes.body.nodes.length, 3);
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

  const overrideRes = await request(app).patch(`/api/devices/${oltId}/override`).send({ admin_override_status: 'DEGRADED' });
  assert.equal(overrideRes.status, 200);

  const interfacesRes = await request(app).get(`/api/interfaces/${oltId}`);
  assert.equal(interfacesRes.status, 200);
  assert.ok(Array.isArray(interfacesRes.body));

  const summaryBulkRes = await request(app).get(`/api/ports/summary?ids=${oltId}`);
  assert.equal(summaryBulkRes.status, 200);
  assert.ok(Array.isArray(summaryBulkRes.body.items));

  const ontListRes = await request(app).get(`/api/ports/ont-list/${oltId}`);
  assert.equal(ontListRes.status, 200);
  assert.ok(Array.isArray(ontListRes.body.items));

  const fiberTypesRes = await request(app).get('/api/optical/fiber-types');
  assert.equal(fiberTypesRes.status, 200);
  assert.ok(Array.isArray(fiberTypesRes.body.items));

  const catalogRes = await request(app).get('/api/catalog/hardware?type=OLT');
  assert.equal(catalogRes.status, 200);
  assert.ok(Array.isArray(catalogRes.body.items));

  const simStatusRes = await request(app).get('/api/sim/status');
  assert.equal(simStatusRes.status, 200);
  assert.equal(typeof simStatusRes.body.interval_ms, 'number');

  const batchHealthRes = await request(app).get('/api/batch/health');
  assert.equal(batchHealthRes.status, 200);
  assert.equal(batchHealthRes.body.status, 'ok');

  const batchCreateRes = await request(app).post('/api/links/batch').send({
    links: [{ sourcePortId: oltPonPort.id, targetPortId: oltPonPort.id }],
    dry_run: true,
    request_id: 'smoke-batch',
  });
  assert.equal(batchCreateRes.status, 200);
  assert.equal(batchCreateRes.body.total_requested, 1);
});
