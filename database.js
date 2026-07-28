import mongoose from 'mongoose';

// Establish a secure connection interface to your remote cloud database
export async function connectDatabase(uri) {
    if (!uri) {
        console.error("⚠️ WARNING: MONGODB_URI environment key is empty! Operating in memory-only layer.");
        return;
    }
    try {
        await mongoose.connect(uri);
        console.log("⚡ [SPOILER-X] Remote MongoDB connection established successfully.");
    } catch (err) {
        console.error("❌ MongoDB connection error baseline:", err.message);
    }
}

// Model design profile for long-term user tracking
const UserSchema = new mongoose.Schema({
    whatsappId: { type: String, required: true, unique: true },
    pushName: { type: String, default: "Unknown User" },
    commandCount: { type: Number, default: 0 },
    role: { type: String, default: "user" }, // Options: user, admin, owner
    firstSeen: { type: Date, default: Date.now },
    lastInteraction: { type: Date, default: Date.now }
});

export const User = mongoose.model('SPOILER_X_User', UserSchema);

