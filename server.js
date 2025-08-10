require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const twilio = require('twilio');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// === Twilio Setup ===
const twilioSID = process.env.TWILIO_ACCOUNT_SID;
const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
const client = twilio(twilioSID, twilioAuth);

// === Enhanced Nodemailer Setup ===
const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// Verify email configuration on startup
transporter.verify((error) => {
  if (error) {
    console.error('❌ Mail server configuration error:', error);
  } else {
    console.log('✅ Mail server is ready to send messages');
  }
});

// === Schemas ===
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  verified: { type: Boolean, default: false },
  otp: String,
  otpExpires: Date,
  resetPasswordToken: String,
  resetPasswordExpire: Date
});

const contactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      required: true
    },
    coordinates: {
      type: [Number],
      required: true
    }
  },
  ipAddress: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const cancellationRequestSchema = new mongoose.Schema({
  paymentId: String,
  destination: String,
  contactNumber: String,
  reason: { type: String, default: "Not specified" },
  status: { type: String, default: "pending", enum: ["pending", "completed", "rejected"] },
  createdAt: { type: Date, default: Date.now }
});

const bookingSchema = new mongoose.Schema({
  travelerInfo: Object,
  addons: Object,
  flightData: Object,
  hotelData: Object,
  carData: Object,
  trainData: Object,
  busData: Object,
  payment: Object,
  bookingId: String,
  userId: String,
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Contact = mongoose.model('Contact', contactSchema);
const CancellationRequest = mongoose.model('CancellationRequest', cancellationRequestSchema);
const Booking = mongoose.model('Booking', bookingSchema);

// Create 2dsphere index for geospatial queries
contactSchema.index({ location: '2dsphere' });

// === Auth Routes ===
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ success: false, message: 'Email already in use' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit OTP

    const user = new User({ 
      name, 
      email, 
      password: hashedPassword,
      otp,
      otpExpires: Date.now() + 10 * 60 * 1000 // 10 min expiry
    });
    await user.save();

    // Send OTP email
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: email,
      subject: 'Your OTP Code',
      html: `<h2>Welcome ${name}!</h2><p>Your OTP is <b>${otp}</b></p><p>It will expire in 10 minutes.</p>`
    });

    res.status(201).json({ success: true, message: 'OTP sent to your email. Please verify.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email });
    
    if (!user) return res.status(400).json({ success: false, message: 'User not found' });
    if (user.otp !== otp) return res.status(400).json({ success: false, message: 'Invalid OTP' });
    if (user.otpExpires < Date.now()) return res.status(400).json({ success: false, message: 'OTP expired' });

    user.verified = true;
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    res.json({ success: true, message: 'Account verified! You can now log in.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    if (!user.verified) return res.status(401).json({ success: false, message: 'Please verify your email first.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '7d' });

    res.json({ 
      success: true, 
      token, 
      user: { name: user.name, email: user.email },
      message: 'Login successful' 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) return res.status(400).json({ success: false, message: 'User not found with this email' });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'secret', { expiresIn: '15m' });

    user.resetPasswordToken = token;
    user.resetPasswordExpire = Date.now() + 15 * 60 * 1000; // 15 minutes
    await user.save();

  const resetLink = `http://localhost:3000/reset-password/${token}`;

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: user.email,
      subject: 'Password Reset Request',
      html: `
        <p>Hello ${user.name},</p>
        <p>You requested to reset your password.</p>
        <p>Click the link below to reset it. This link expires in 15 minutes:</p>
        <a href="${resetLink}" target="_blank">${resetLink}</a>
        <p>If you did not request this, please ignore this email.</p>
      `
    });

    res.json({ success: true, message: 'Reset link sent to your email.' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/auth/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const user = await User.findOne({
      _id: decoded.userId,
      resetPasswordToken: token,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired token' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// === Contact Form with Dual Email Notifications ===
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, phone, subject, message, coordinates } = req.body;
    
    // Validation
    if (!name || !email || !subject || !message || !coordinates) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    // Save to database
    const newContact = new Contact({
      name,
      email,
      phone,
      subject,
      message,
      location: {
        type: 'Point',
        coordinates: coordinates
      },
      ipAddress: req.ip
    });

    await newContact.save();

    // Email configurations
    const emailPromises = [];
    const mailResults = { admin: false, client: false };

    // 1. Admin Notification Email
    const adminMail = {
      from: `"Contact Form" <${process.env.GMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: `New Contact: ${subject}`,
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h2 style="color: #2c3e50;">New Contact Submission</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px; border: 1px solid #ddd; width: 30%;"><strong>Name:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${name}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Email:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${email}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Phone:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${phone || 'Not provided'}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Subject:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${subject}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Message:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${message}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Location:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${coordinates.join(', ')}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>IP Address:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${req.ip}</td></tr>
          </table>
        </div>
      `
    };

    // 2. Client Confirmation Email
    const clientMail = {
      from: `"Tourism Support" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: 'We Received Your Message!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #f8f9fa; padding: 20px; text-align: center;">
            <h1 style="color: #2c3e50; margin: 0;">Thank You, ${name}!</h1>
          </div>
          <div style="padding: 20px;">
            <p>We've received your message and will respond within 24 hours.</p>
            <div style="background: #f1f1f1; padding: 15px; margin: 20px 0; border-left: 4px solid #3498db;">
              <p><strong>Your Message:</strong></p>
              <p>${message}</p>
            </div>
            <p>For urgent inquiries, please call our support team at +1 (555) 123-4567.</p>
            <p style="margin-top: 30px;">Best regards,<br>The Tourism Team</p>
          </div>
          <div style="background: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #7f8c8d;">
            <p>This is an automated message. Please do not reply directly to this email.</p>
          </div>
        </div>
      `
    };

    // Send both emails
    emailPromises.push(
      transporter.sendMail(adminMail)
        .then(() => { mailResults.admin = true; })
        .catch(err => console.error('Admin email error:', err))
    );

    emailPromises.push(
      transporter.sendMail(clientMail)
        .then(() => { mailResults.client = true; })
        .catch(err => console.error('Client email error:', err))
    );

    await Promise.all(emailPromises);

    res.status(201).json({
      success: true,
      message: 'Contact form submitted successfully!',
      emailsSent: mailResults
    });

  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

// === Cancellation Requests ===
app.post('/api/cancellation-requests', async (req, res) => {
  try {
    const { paymentId, destination, contactNumber, reason } = req.body;
    const newRequest = new CancellationRequest({ paymentId, destination, contactNumber, reason });
    const savedRequest = await newRequest.save();
    res.status(201).json(savedRequest);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/cancellation-requests', async (req, res) => {
  try {
    const requests = await CancellationRequest.find().sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// === Bookings ===
app.post('/api/bookings', async (req, res) => {
  try {
    const { travelerInfo, addons, flightData, hotelData, carData, trainData, busData, payment, bookingId, userId } = req.body;
    
    const newBooking = new Booking({
      travelerInfo,
      addons,
      flightData,
      hotelData,
      carData,
      trainData,
      busData,
      payment,
      bookingId,
      userId
    });

    const savedBooking = await newBooking.save();

    // Send emails to both admin and user
    const emailPromises = [];
    const mailResults = { admin: false, user: false };

    // 1. Admin Notification Email
    const adminMail = {
      from: `"Booking System" <${process.env.GMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: `New Booking: ${bookingId}`,
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h2 style="color: #2c3e50;">New Booking Received</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px; border: 1px solid #ddd; width: 30%;"><strong>Booking ID:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${bookingId}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Traveler:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${travelerInfo.name}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Email:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${travelerInfo.email}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Phone:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${travelerInfo.phone}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Amount Paid:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">₹${payment.amount}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Payment ID:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${payment.razorpayPaymentId}</td></tr>
          </table>
          <h3 style="color: #2c3e50; margin-top: 20px;">Booking Details</h3>
          <p>Please check the admin dashboard for complete booking details.</p>
        </div>
      `
    };

    // 2. User Confirmation Email
    const userMail = {
      from: `"Tourism Booking" <${process.env.GMAIL_USER}>`,
      to: travelerInfo.email,
      subject: `Your Booking Confirmation - ${bookingId}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #f8f9fa; padding: 20px; text-align: center;">
            <h1 style="color: #2c3e50; margin: 0;">Booking Confirmed!</h1>
          </div>
          <div style="padding: 20px;">
            <p>Dear ${travelerInfo.name},</p>
            <p>Thank you for booking with us. Here are your booking details:</p>
            
            <div style="background: #f1f1f1; padding: 15px; margin: 20px 0; border-left: 4px solid #3498db;">
              <p><strong>Booking ID:</strong> ${bookingId}</p>
              <p><strong>Amount Paid:</strong> ₹${payment.amount}</p>
              <p><strong>Payment Status:</strong> ${payment.status}</p>
            </div>
            
            <p>You can view your booking details anytime by logging into your account.</p>
            <p>If you have any questions, please contact our support team.</p>
            
            <p style="margin-top: 30px;">Best regards,<br>The Tourism Team</p>
          </div>
          <div style="background: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #7f8c8d;">
            <p>This is an automated message. Please do not reply directly to this email.</p>
          </div>
        </div>
      `
    };

    // Send both emails
    emailPromises.push(
      transporter.sendMail(adminMail)
        .then(() => { mailResults.admin = true; })
        .catch(err => console.error('Admin email error:', err))
    );

    emailPromises.push(
      transporter.sendMail(userMail)
        .then(() => { mailResults.user = true; })
        .catch(err => console.error('User email error:', err))
    );

    await Promise.all(emailPromises);

    res.json({
      success: true,
      booking: savedBooking,
      emailsSent: mailResults
    });

  } catch (error) {
    console.error('Error saving booking:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to save booking',
      details: error.message
    });
  }
});

app.get('/api/bookings/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const bookings = await Booking.find({ userId });
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// === Refund ===
app.post('/api/refund', async (req, res) => {
  try {
    const { payment_id, amount, reason } = req.body;

    const refundResponse = await axios.post(
      `https://api.razorpay.com/v1/payments/${payment_id}/refund`,
      {
        amount: Math.round(amount * 100),
        speed: "normal",
        notes: { reason: reason || "Customer requested refund" }
      },
      {
        auth: {
          username: process.env.RAZORPAY_KEY_ID,
          password: process.env.RAZORPAY_KEY_SECRET
        }
      }
    );

    await Booking.findOneAndUpdate(
      { "payment.razorpayPaymentId": payment_id },
      {
        "payment.status": 'cancelled',
        cancellationDetails: {
          date: new Date(),
          reason,
          refundAmount: amount,
          refundId: refundResponse.data.id,
          refundStatus: refundResponse.data.status
        }
      }
    );

    res.json({
      success: true,
      refund_id: refundResponse.data.id,
      amount,
      status: refundResponse.data.status
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.response?.data?.error?.description || 'Refund processing failed'
    });
  }
});

// === Twilio Call ===
app.post('/api/call-user', async (req, res) => {
  const { phoneNumber, placeName } = req.body;

  try {
    const twimlUrl = `https://${req.headers.host}/twiml/${encodeURIComponent(placeName)}`;
    await client.calls.create({
      url: twimlUrl,
      to: phoneNumber,
      from: twilioPhone,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Error making call:', err);
    res.status(500).json({ error: 'Call failed' });
  }
});

app.get('/twiml/:placeName', (req, res) => {
  const place = decodeURIComponent(req.params.placeName);
  const twimlResponse = `
    <Response>
      <Say voice="alice">
        Hello! Thank you for your interest in ${place}.
        It is one of the most beautiful destinations with amazing attractions and facilities.
        Visit our website to book now!
      </Say>
    </Response>
  `;
  res.type('text/xml');
  res.send(twimlResponse);
});

// === Start Server ===
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});