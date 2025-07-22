const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  destination: String,
  startDate: Date,
  endDate: Date,
  packageType: String,
  duration: Number,
  travelers: Number,
  travelerInfo: {
    name: String,
    email: String,
    phone: String,
    address: String
  },
  addons: {
    flight: Boolean,
    hotel: Boolean,
    car: Boolean,
    train: Boolean,
    guide: Boolean
  },
  flightData: Object,
  hotelData: Object,
  carData: Object,
  trainData: Object,
  payment: {
    amount: Number,
    status: String,
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    receipt: Object
  },
  bookingId: {
    type: String,
    required: true,
    unique: true
  },
  cancellationDetails: {
    date: Date,
    reason: String,
    refundAmount: Number,
    refundId: String,
    refundStatus: String
  }
}, { timestamps: true });

module.exports = mongoose.model('Booking', bookingSchema);