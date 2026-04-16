// apps/api/models/Ticket.js
const mongoose = require('mongoose');
const Counter = require('./Counter');

const ticketSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    number: { type: String, required: true, unique: true, sparse: true },
    title: { type: String, required: true },
    detail: { type: String, required: true },
    priority: { type: String, enum: ['low','medium','high','critical'], default: 'medium' },
    email: { type: String, required: true },
    type: { type: String, default: 'support' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      default: null,
    },
    clientName: { type: String, trim: true, default: null },
    fromImap: { type: Boolean, default: false },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isComplete: { type: Boolean, default: false },
    status: { type: String, default: 'open' },
    note: String,
    hidden: { type: Boolean, default: false },
    locked: { type: Boolean, default: false },
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Thread', default: null, index: true },
    sourceCaseId: { type: String, trim: true, default: null, index: true, sparse: true },
    currentStage: { type: String, trim: true, default: null },
    claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    mailboxId: { type: mongoose.Schema.Types.ObjectId, ref: 'Mailbox', default: null },
    emailId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailMessage', default: null }
  },
  { timestamps: true }
);

ticketSchema.index({ sourceCaseId: 1, hidden: 1 }, { sparse: true });

ticketSchema.pre('validate', async function(next) {
  if (!this.number) {
    const counter = await Counter.findByIdAndUpdate(
      { _id: 'ticket' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    this.number = `TKT-${String(counter.seq).padStart(6, '0')}`;
  }
  next();
});

module.exports = mongoose.models.Ticket || mongoose.model('Ticket', ticketSchema);
