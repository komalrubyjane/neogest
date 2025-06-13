require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const mqtt = require('mqtt');
const { protect } = require('./middleware/auth');

const app = express();

// In-memory user storage
const users = new Map();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Email configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'neogestnoreply@gmail.com',
        pass: process.env.EMAIL_APP_PASSWORD
    }
});

// MQTT Configuration
const mqttClient = mqtt.connect('mqtt://broker.hivemq.com');

// MQTT Topics
const TOPICS = {
    LIGHT: 'neogest/light',
    FAN: 'neogest/fan',
    STATUS: 'neogest/status'
};

// Cache for last known status
let lastStatus = {
    connected: false,
    light: false,
    fan: false,
    ip: null,
    rssi: null
};

// MQTT Connection handling
mqttClient.on('connect', () => {
    console.log('Connected to MQTT broker');
    mqttClient.subscribe(TOPICS.STATUS);
});

mqttClient.on('message', (topic, message) => {
    if (topic === TOPICS.STATUS) {
        try {
            lastStatus = JSON.parse(message.toString());
            lastStatus.connected = true;
        } catch (e) {
            console.error('Failed to parse status message:', e);
        }
    }
});

// Generate OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Routes
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Check if user exists
        if (users.has(email)) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Generate OTP
        const otp = generateOTP();
        const otpExpiry = new Date();
        otpExpiry.setMinutes(otpExpiry.getMinutes() + 10); // OTP valid for 10 minutes

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create new user
        const userId = Date.now().toString();
        const user = {
            id: userId,
            name,
            email,
            password: hashedPassword,
            emailVerificationOTP: otp,
            otpExpiry,
            isEmailVerified: false,
            role: 'user'
        };

        users.set(email, user);

        // Send verification email
        const mailOptions = {
            from: 'neogestnoreply@gmail.com',
            to: email,
            subject: 'Email Verification - NeoGest',
            html: `
                <h2>Welcome to NeoGest!</h2>
                <p>Your verification code is: <strong>${otp}</strong></p>
                <p>This code will expire in 10 minutes.</p>
            `
        };

        await transporter.sendMail(mailOptions);

        res.status(201).json({
            message: 'Registration successful. Please check your email for verification code.',
            userId: user.id
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/verify-email', async (req, res) => {
    try {
        const { userId, otp } = req.body;

        // Find user by ID
        const user = Array.from(users.values()).find(u => u.id === userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.isEmailVerified) {
            return res.status(400).json({ message: 'Email already verified' });
        }

        if (user.emailVerificationOTP !== otp) {
            return res.status(400).json({ message: 'Invalid OTP' });
        }

        if (new Date() > user.otpExpiry) {
            return res.status(400).json({ message: 'OTP expired' });
        }

        user.isEmailVerified = true;
        user.emailVerificationOTP = null;
        user.otpExpiry = null;
        users.set(user.email, user);

        // Create token
        const token = jwt.sign(
            { userId: user.id },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            message: 'Email verified successfully',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Check if user exists
        const user = users.get(email);
        if (!user) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Check if email is verified
        if (!user.isEmailVerified) {
            return res.status(400).json({ message: 'Please verify your email first' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Create token
        const token = jwt.sign(
            { userId: user.id },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Protected Routes
app.get('/api/profile', protect, async (req, res) => {
    try {
        const user = Array.from(users.values()).find(u => u.id === req.user.userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const { password, emailVerificationOTP, otpExpiry, ...userWithoutSensitive } = user;
        res.json(userWithoutSensitive);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.put('/api/profile', protect, async (req, res) => {
    try {
        const { name, phone, address } = req.body;
        const user = Array.from(users.values()).find(u => u.id === req.user.userId);
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (name) user.name = name;
        if (phone) user.phone = phone;
        if (address) user.address = address;

        users.set(user.email, user);

        res.json({
            message: 'Profile updated successfully',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                address: user.address,
                role: user.role
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Device Control Routes
app.post('/api/device/control', protect, async (req, res) => {
    try {
        const { device, state } = req.body;
        const topic = device === 'light' ? TOPICS.LIGHT : TOPICS.FAN;
        const message = state ? 'ON' : 'OFF';

        mqttClient.publish(topic, message);
        res.json({ message: 'Command sent successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.get('/api/device/status', protect, (req, res) => {
    res.json(lastStatus);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(Server running on port ${PORT}));
