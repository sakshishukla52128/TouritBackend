// server/models/CancellationRequest.js
const mongoose = require('mongoose');

const cancellationRequestSchema = new mongoose.Schema({
  paymentId: {
    type: String,
    required: true,
  },
  destination: {
    type: String,
    required: true,
  },
  contactNumber: {
    type: String,
    required: true,
  },
  reason: {
    type: String,
    default: "Not specified",
  },
  status: {
    type: String,
    default: "pending",
    enum: ["pending", "completed", "rejected"],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('CancellationRequest', cancellationRequestSchema);