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

async function connectDB() {
  try {
    await client.connect();
    const db = client.db("mahiBakery");
    usageCollection = db.collection("dailyUsage");
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

// POST - Save Daily Usage
app.post("/usage", async (req, res) => {
  try {
    const data = req.body;
    const result = await usageCollection.insertOne(data);
    res.status(201).json({ insertedId: result.insertedId });
  } catch (error) {
    res.status(500).json({ error: "Failed to insert data" });
  }
});

// GET - Get Usage by Date
app.get("/api/usage/:date", async (req, res) => {
  try {
    const queryDate = req.params.date;
    const result = await usageCollection.findOne({ date: queryDate });
    if (!result) return res.status(404).json({ message: "No data found" });
    res.json(result);
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

// Start server
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
