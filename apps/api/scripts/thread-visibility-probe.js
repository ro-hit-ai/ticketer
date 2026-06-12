require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const THREAD_ID = '6a2bb58648290b17256318dd';

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pp';
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  // 1. Full raw document — EVERY field
  const thread = await db.collection('threads').findOne({
    _id: new mongoose.Types.ObjectId(THREAD_ID),
  });

  console.log('\n=== FULL RAW MONGO DOCUMENT ===\n');
  console.log(JSON.stringify(thread, (key, val) => {
    if (key === '_id' && val) return String(val);
    if (val instanceof mongoose.Types.ObjectId) return String(val);
    if (val instanceof Date) return val.toISOString();
    if (key === 'metadata' && val && typeof val === 'object') return val;
    return val;
  }, 2));

  // 2. Raw field inventory
  console.log('\n=== FIELD INVENTORY ===\n');
  const keys = Object.keys(thread || {}).sort();
  keys.forEach(k => {
    let v = thread[k];
    if (v instanceof mongoose.Types.ObjectId) v = `ObjectId("${v}")`;
    else if (v instanceof Date) v = v.toISOString();
    else if (typeof v === 'object' && v !== null) v = JSON.stringify(v);
    console.log(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  });

  // 3. Simulate LIST endpoint pipeline
  // Same select as threads.js:590-591
  const inboxThreadFields = 'sourceCaseId subject lastMessage lastMessageAt unreadCount mailboxId';
  const Thread = require('../src/models/Thread');
  const leanThread = await Thread.findById(THREAD_ID)
    .select(`${inboxThreadFields} componentKey metadata workflowSnapshot lastAssignedUserId createdBy claimedBy`)
    .lean();

  console.log('\n=== AFTER .select().lean() ===\n');
  console.log(JSON.stringify(leanThread, null, 2));

  // 4. Simulate filterAuthorizedThreads destructuring (threads.js:305-313)
  const {
    componentKey,
    metadata,
    workflowSnapshot,
    lastAssignedUserId,
    createdBy,
    claimedBy,
    ...publicThread
  } = leanThread || {};

  console.log('\n=== publicThread (after destructure removal) ===\n');
  console.log(JSON.stringify(publicThread, null, 2));

  // 5. Compare fields
  console.log('\n=== FIELD-BY-FIELD COMPARISON ===\n');
  const raw = thread || {};
  const expectedInPublic = ['_id', 'sourceCaseId', 'subject', 'lastMessage', 'lastMessageAt', 'unreadCount', 'mailboxId'];
  const removedFields = ['componentKey', 'metadata', 'workflowSnapshot', 'lastAssignedUserId', 'createdBy', 'claimedBy'];

  console.log('Fields that SHOULD survive to publicThread:');
  expectedInPublic.forEach(f => {
    const inRaw = f in raw;
    const inPublic = f in (publicThread || {});
    const rawVal = raw[f];
    const pubVal = publicThread?.[f];
    console.log(`  ${f}: inRaw=${inRaw} inPublic=${inPublic} match=${JSON.stringify(rawVal) === JSON.stringify(pubVal)}`);
  });

  console.log('\nFields that SHOULD be removed:');
  removedFields.forEach(f => {
    const inRaw = f in raw;
    const inPublic = f in (publicThread || {});
    console.log(`  ${f}: inRaw=${inRaw} inPublic=${inPublic} removed=${!inPublic}`);
  });

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Probe failed:', err.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
