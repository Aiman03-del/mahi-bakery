const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const dotenv = require("dotenv");
const moment = require("moment");
dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Setup
const client = new MongoClient(process.env.MONGODB_URI);
let usageCollection;
let itemsCollection;
let ingredientsCollection;
let usersCollection; // <-- add

async function connectDB() {
  try {
    await client.connect();
    const db = client.db("mahiBakery");
    usageCollection = db.collection("dailyUsage");
    itemsCollection = db.collection("items");
    ingredientsCollection = db.collection("ingredients");
    usersCollection = db.collection("users"); // <-- add
    console.log("✅ Connected to MongoDB");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
  }
}
connectDB();

// Home route - Welcome message
app.get("/", (req, res) => {
  res.send("স্বাগতম! মাহি বেকারির সার্ভার চলছে 🚀");
});

// Helper: always get date as yyyy-MM-dd (local time zone safe)
const toDateKey = (date) => {
  if (!date) return "";
  // If already yyyy-MM-dd, return as is
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  // Otherwise, parse and convert
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  // Convert to local date string (not UTC)
  const tzOffset = d.getTimezoneOffset() * 60000;
  const localISO = new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
  return localISO;
};

// POST - Save Daily Usage
app.post("/usage", async (req, res) => {
  try {
    const data = req.body;
    // Always save date as yyyy-MM-dd
    const dateKey = toDateKey(data.date);
    await usageCollection.deleteMany({ date: dateKey });
    // Save retails array if present
    const doc = { ...data, date: dateKey };
    if (!doc.retails) doc.retails = [];
    if (!doc.pieces) doc.pieces = []; // Ensure pieces is always present
    const result = await usageCollection.insertOne(doc);
    res.status(201).json({ insertedId: result.insertedId });
  } catch (error) {
    res.status(500).json({ error: "Failed to insert data" });
  }
});

// GET - Get Usage by Date
app.get("/api/usage/:date", async (req, res) => {
  try {
    const dateKey = toDateKey(req.params.date);
    const result = await usageCollection.findOne({ date: dateKey });
    if (!result) {
      // Return empty usage data instead of 404
      return res.json({
        items: [],
        prices: [],
        retails: [],
        pieces: [], // Return empty pieces array if not found
        totalExpense: "0",
      });
    }
    res.json({
      items: result.items || [],
      prices: result.prices || [],
      retails: result.retails || [],
      pieces: result.pieces || [], // Return pieces from DB
      totalExpense: result.totalExpense || "0",
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// GET - All Usage (with filter: day/week/month, using moment)
app.get("/api/usage", async (req, res) => {
  try {
    const filter = req.query.filter || "day";
    const usages = await usageCollection.find({}).sort({ _id: -1 }).toArray();

    if (filter === "day") {
      return res.json(usages);
    }

    const grouped = {};
    usages.forEach(u => {
      let m = moment(u.date, [
        "YYYY-MM-DD",
        "YYYY/MM/DD",
        "YYYY-MM-DD dddd",
        "YYYY/MM/DD dddd",
        "LL dddd",
        "LL",
        "l",
        "dddd, D MMMM YYYY",
        "D MMMM YYYY",
      ], "bn", true);
      if (!m.isValid()) {
        m = moment(new Date(u.date.replace(/[^\d-]/g, "-")));
      }
      if (!m.isValid()) {
        console.warn("Invalid date for usage entry:", u.date);
        return;
      }

      let key, label;
      if (filter === "week") {
        // Find previous Saturday (start of week)
        const start = m.clone().day(6); // Saturday
        if (m.day() < 6) start.subtract(7, "days"); // If before Saturday, go to last week's Saturday
        const end = start.clone().add(6, "days"); // Friday

        // Format: শনি-শুক্র (DD/MM/YYYY - DD/MM/YYYY)
        label = `শনি-শুক্র (${start.format("DD/MM/YYYY")} - ${end.format("DD/MM/YYYY")})`;
        key = start.format("YYYY-MM-DD"); // Use start date as key
      } else if (filter === "month") {
        label = `${m.year()}-${m.month() + 1}মাস`;
        key = label;
      }

      if (!grouped[key]) {
        grouped[key] = {
          date: label,
          items: [],
          totalExpense: 0,
        };
      }
      u.items.forEach(item => {
        const idx = grouped[key].items.findIndex(i => i.name === item.name);
        if (idx > -1) {
          grouped[key].items[idx].totalKg = (
            parseFloat(grouped[key].items[idx].totalKg) + parseFloat(item.totalKg)
          ).toFixed(2);
        } else {
          grouped[key].items.push({ ...item });
        }
      });
      grouped[key].totalExpense += parseFloat(u.totalExpense);
    });

    Object.values(grouped).forEach(g => {
      g.totalExpense = g.totalExpense.toFixed(2);
    });

    return res.json(Object.values(grouped));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch usages" });
  }
});

// --- Items API ---
app.get("/api/items", async (req, res) => {
  try {
    const items = await itemsCollection.find({}).sort({ _id: -1 }).toArray();
    res.json(items);
  } catch {
    res.status(500).json({ error: "Failed to fetch items" });
  }
});
app.post("/api/items", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Name required" });
    const exists = await itemsCollection.findOne({ name });
    if (exists) return res.status(409).json({ error: "Already exists" });
    const result = await itemsCollection.insertOne({ name });
    res.status(201).json({ insertedId: result.insertedId });
  } catch {
    res.status(500).json({ error: "Failed to add item" });
  }
});

// --- Ingredients API ---
app.get("/api/ingredients", async (req, res) => {
  try {
    const ingredients = await ingredientsCollection.find({}).sort({ _id: -1 }).toArray();
    res.json(ingredients);
  } catch {
    res.status(500).json({ error: "Failed to fetch ingredients" });
  }
});
app.post("/api/ingredients", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Name required" });
    const exists = await ingredientsCollection.findOne({ name });
    if (exists) return res.status(409).json({ error: "Already exists" });
    const result = await ingredientsCollection.insertOne({ name });
    res.status(201).json({ insertedId: result.insertedId });
  } catch {
    res.status(500).json({ error: "Failed to add ingredient" });
  }
});

// --- Users API ---
// Save user (upsert by email)
app.post("/api/users", async (req, res) => {
  try {
    const { displayName, photoURL, email, role } = req.body;
    console.log("Received user data:", req.body); // <-- লগ করুন
    if (!email) return res.status(400).json({ error: "Email required" });
    const userDoc = { displayName, photoURL, email, role: role || "user" };
    const result = await usersCollection.updateOne(
      { email },
      { $set: userDoc },
      { upsert: true }
    );
    console.log("MongoDB upsert result:", result); // <-- লগ করুন
    res.status(201).json({ message: "User saved" });
  } catch (err) {
    console.error("❌ Failed to save user:", err); // <-- এরর লগ করুন
    res.status(500).json({ error: "Failed to save user" });
  }
});

// Get user by email
app.get("/api/users/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(200).json({});
    res.json(user);
  } catch {
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
