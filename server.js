// Convert all imports to CommonJS require style:
const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
const moment = require("moment");
const http = require("http");
const { Server } = require("socket.io");
dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// --- Socket.io setup ---
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Adjust as needed for production
    methods: ["GET", "POST"],
  },
});
io.on("connection", (socket) => {
  console.log("🔌 Client connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
  });
});
// Make io accessible in routes
app.set("io", io);

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Setup
const client = new MongoClient(process.env.MONGODB_URI);
let usageCollection;
let itemsCollection;
let ingredientsCollection;
let usersCollection; // <-- add
let salesmenCollection; // <-- add
let salesmanOrdersCollection; // <-- add
let salesmanDayOrdersCollection; // <-- add
let dailySalesCollection; // <-- add

async function connectDB() {
  try {
    await client.connect();
    const db = client.db("mahiBakery");
    usageCollection = db.collection("dailyUsage");
    itemsCollection = db.collection("items");
    ingredientsCollection = db.collection("ingredients");
    usersCollection = db.collection("users"); // <-- add
    salesmenCollection = db.collection("salesmen"); // <-- add
    salesmanOrdersCollection = db.collection("salesmanOrders"); // <-- add
    salesmanDayOrdersCollection = db.collection("salesmanDayOrders"); // <-- add
    dailySalesCollection = db.collection("dailySales"); // <-- add
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
    // Store selectedItems if present
    if (!doc.selectedItems) doc.selectedItems = [];
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
        pieces: [],
        totalExpense: "0",
        selectedItems: [], // <-- return empty selectedItems if not found
      });
    }
    res.json({
      items: result.items || [],
      prices: result.prices || [],
      retails: result.retails || [],
      pieces: result.pieces || [],
      totalExpense: result.totalExpense || "0",
      selectedItems: result.selectedItems || [], // <-- return selectedItems from DB
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
    usages.forEach((u) => {
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
      u.items.forEach((item) => {
        const idx = grouped[key].items.findIndex((i) => i.name === item.name);
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

    Object.values(grouped).forEach((g) => {
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
    const { search } = req.query;
    let query = {};
    if (search) {
      query = { name: { $regex: search, $options: "i" } };
    }
    const items = await itemsCollection.find(query).sort({ _id: -1 }).toArray();
    // Ensure price field exists
    items.forEach((item) => { if (item.price === undefined) item.price = ""; });
    res.json(items);
  } catch {
    res.status(500).json({ error: "Failed to fetch items" });
  }
});
app.post("/api/items", async (req, res) => {
  try {
    const { name, price, category } = req.body;
    if (!name) return res.status(400).json({ error: "Name required" });
    const exists = await itemsCollection.findOne({ name });
    if (exists) return res.status(409).json({ error: "Already exists" });
    const result = await itemsCollection.insertOne({ name, price: price || "", category: category || "" });
    res.status(201).json({ insertedId: result.insertedId });
  } catch {
    res.status(500).json({ error: "Failed to add item" });
  }
});

// --- Ingredients API ---
app.get("/api/ingredients", async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};
    if (search) {
      query = { name: { $regex: search, $options: "i" } };
    }
    const ingredients = await ingredientsCollection.find(query).sort({ _id: -1 }).toArray();
    ingredients.forEach((ing) => { if (ing.price === undefined) ing.price = ""; });
    res.json(ingredients);
  } catch {
    res.status(500).json({ error: "Failed to fetch ingredients" });
  }
});
app.post("/api/ingredients", async (req, res) => {
  try {
    const { name, price } = req.body;
    if (!name) return res.status(400).json({ error: "Name required" });
    const exists = await ingredientsCollection.findOne({ name });
    if (exists) return res.status(409).json({ error: "Already exists" });
    const result = await ingredientsCollection.insertOne({ name, price: price || "" });
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

// --- Manage Items & Ingredients API ---
// Get all items and ingredients together
app.get("/api/manage", async (req, res) => {
  try {
    const items = await itemsCollection.find({}).sort({ _id: -1 }).toArray();
    const ingredients = await ingredientsCollection.find({}).sort({ _id: -1 }).toArray();
    items.forEach((item) => { if (item.price === undefined) item.price = ""; });
    ingredients.forEach((ing) => { if (ing.price === undefined) ing.price = ""; });
    res.json({ items, ingredients });
  } catch {
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// Update item by id
app.put("/api/items/:id", async (req, res) => {
  try {
    const { name, price, category } = req.body;
    const id = req.params.id;
    if (!name) return res.status(400).json({ error: "Name required" });
    const updateDoc = { name };
    if (price !== undefined) updateDoc.price = price;
    if (category !== undefined) updateDoc.category = category;
    const result = await itemsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc }
    );
    res.json({ modifiedCount: result.modifiedCount });
  } catch {
    res.status(500).json({ error: "Failed to update item" });
  }
});

// Delete item by id
app.delete("/api/items/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await itemsCollection.deleteOne({ _id: new ObjectId(id) });
    res.json({ deletedCount: result.deletedCount });
  } catch {
    res.status(500).json({ error: "Failed to delete item" });
  }
});

// Update ingredient by id
app.put("/api/ingredients/:id", async (req, res) => {
  try {
    const { name, price } = req.body;
    const id = req.params.id;
    if (!name) return res.status(400).json({ error: "Name required" });
    const updateDoc = { name };
    if (price !== undefined) updateDoc.price = price;
    const result = await ingredientsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc }
    );
    res.json({ modifiedCount: result.modifiedCount });
  } catch {
    res.status(500).json({ error: "Failed to update ingredient" });
  }
});

// Delete ingredient by id
app.delete("/api/ingredients/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await ingredientsCollection.deleteOne({ _id: new ObjectId(id) });
    res.json({ deletedCount: result.deletedCount });
  } catch {
    res.status(500).json({ error: "Failed to delete ingredient" });
  }
});

// --- Salesmen API ---
// Get all salesmen
app.get("/api/salesmen", async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};
    if (search) {
      query = { name: { $regex: search, $options: "i" } };
    }
    const salesmen = await salesmenCollection.find(query).sort({ _id: 1 }).toArray();
    res.json(salesmen);
  } catch {
    res.status(500).json({ error: "Failed to fetch salesmen" });
  }
});

// Add a new salesman
app.post("/api/salesmen", async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name) return res.status(400).json({ error: "Name required" });
    const exists = await salesmenCollection.findOne({ name });
    if (exists) return res.status(409).json({ error: "Already exists" });
    // phone can be empty or undefined, always save as string (even if empty)
    const result = await salesmenCollection.insertOne({ name, phone: phone ? phone : "" });
    res.status(201).json({ insertedId: result.insertedId });
  } catch {
    res.status(500).json({ error: "Failed to add salesman" });
  }
});

// Update salesman by id
app.put("/api/salesmen/:id", async (req, res) => {
  try {
    const { name, phone } = req.body;
    const id = req.params.id;
    if (!name) return res.status(400).json({ error: "Name required" });
    const updateDoc = { name };
    if (phone !== undefined) updateDoc.phone = phone;
    else updateDoc.phone = "";
    const result = await salesmenCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc }
    );
    res.json({ modifiedCount: result.modifiedCount });
  } catch {
    res.status(500).json({ error: "Failed to update salesman" });
  }
});

// Delete salesman by id
app.delete("/api/salesmen/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await salesmenCollection.deleteOne({ _id: new ObjectId(id) });
    res.json({ deletedCount: result.deletedCount });
  } catch {
    res.status(500).json({ error: "Failed to delete salesman" });
  }
});

// --- Salesman Orders API ---
// Each order: { salesmanId, itemId, qty, date }
// Get orders for a specific date (or all if no date)
app.get("/api/salesman-orders", async (req, res) => {
  try {
    const { date } = req.query;
    let query = {};
    if (date) query.date = date;
    const orders = await salesmanOrdersCollection.find(query).toArray();
    res.json(orders);
  } catch {
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// Add or update a salesman order (upsert by salesmanId, itemId, date)
app.post("/api/salesman-orders", async (req, res) => {
  try {
    const { salesmanId, itemId, qty, date } = req.body;
    if (!salesmanId || !itemId || !date) {
      return res.status(400).json({ error: "salesmanId, itemId, date required" });
    }
    const filter = { salesmanId, itemId, date };
    const update = { $set: { salesmanId, itemId, qty, date } };
    const result = await salesmanOrdersCollection.updateOne(filter, update, { upsert: true });
    res.status(201).json({ upserted: result.upsertedId, modified: result.modifiedCount });
  } catch {
    res.status(500).json({ error: "Failed to save order" });
  }
});

// Update order quantity (by _id)
app.put("/api/salesman-orders/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { qty } = req.body;
    if (qty === undefined) return res.status(400).json({ error: "qty required" });
    const result = await salesmanOrdersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { qty } }
    );
    res.json({ modifiedCount: result.modifiedCount });
  } catch {
    res.status(500).json({ error: "Failed to update order" });
  }
});

// --- Ghorer Mal API ---
// Each entry: { itemId, date, qty }
app.get("/api/ghorer-mal", async (req, res) => {
  try {
    const { date } = req.query;
    let query = {};
    if (date) query.date = date;
    const data = await client.db("mahiBakery").collection("ghorerMal").find(query).toArray();
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to fetch ghorer mal" });
  }
});

// Save or update ghorer mal for an item and date
app.post("/api/ghorer-mal", async (req, res) => {
  try {
    const { itemId, qty, date } = req.body;
    if (!itemId || !date) return res.status(400).json({ error: "itemId, date required" });
    const filter = { itemId, date };
    const update = { $set: { itemId, qty, date } };
    const result = await client.db("mahiBakery").collection("ghorerMal").updateOne(filter, update, { upsert: true });
    res.status(201).json({ upserted: result.upsertedId, modified: result.modifiedCount });
  } catch {
    res.status(500).json({ error: "Failed to save ghorer mal" });
  }
});

// --- Daily Summary API ---
// Get daily summary: all salesman orders and ghorer mal for a date
app.get("/api/salesman-summary/:date", async (req, res) => {
  try {
    const date = req.params.date;
    // All orders for this date
    const orders = await salesmanOrdersCollection.find({ date }).toArray();
    // All ghorer mal for this date
    const ghorerMal = await client.db("mahiBakery").collection("ghorerMal").find({ date }).toArray();
    res.json({ orders, ghorerMal });
  } catch {
    res.status(500).json({ error: "Failed to fetch summary" });
  }
});

// --- Salesman Day Orders Summary API ---
// Save or update daily summary with new structure
app.post("/api/salesman-day-orders", async (req, res) => {
  try {
    const { date, salesman, ghorerMalTotal, motPcsTotal } = req.body;
    if (!date || !Array.isArray(salesman)) {
      return res.status(400).json({ error: "date and salesman array required" });
    }
    // salesman: array of { salesmanId, itemId, qty }
    const filter = { date };
    const update = {
      $set: {
        date,
        salesman, // array of { salesmanId, itemId, qty }
        ghorerMalTotal: ghorerMalTotal || 0,
        motPcsTotal: motPcsTotal || 0,
      },
    };
    const result = await salesmanDayOrdersCollection.updateOne(filter, update, { upsert: true });
    res.status(201).json({ upserted: result.upsertedId, modified: result.modifiedCount });
  } catch {
    res.status(500).json({ error: "Failed to save daily summary" });
  }
});

// Get daily summary by date (returns structure as described)
app.get("/api/salesman-day-orders/:date", async (req, res) => {
  try {
    const date = req.params.date;
    const doc = await salesmanDayOrdersCollection.findOne({ date });
    if (!doc) {
      return res.status(200).json({
        _id: null,
        date,
        salesman: [],
        ghorerMalTotal: 0,
        motPcsTotal: 0,
      });
    }
    res.json(doc);
  } catch {
    res.status(500).json({ error: "Failed to fetch daily summary" });
  }
});

// Get all daily summaries
app.get("/api/salesman-day-orders", async (req, res) => {
  try {
    const docs = await salesmanDayOrdersCollection.find({}).sort({ date: -1 }).toArray();
    res.json(docs);
  } catch {
    res.status(500).json({ error: "Failed to fetch daily summaries" });
  }
});

// --- Daily Sale API ---
// Add POST /api/daily-sale endpoint for saving daily sales by date
app.post("/api/daily-sale", async (req, res) => {
  try {
    const { date, sales } = req.body;
    if (!date || !Array.isArray(sales)) {
      return res.status(400).json({ error: "date and sales array required" });
    }
    // Remove previous entries for this date
    await dailySalesCollection.deleteMany({ date });
    // Insert all sales, including selectedCategories for each salesman
    await dailySalesCollection.insertMany(
      sales.map((sale) => ({
        ...sale,
        date,
        selectedCategories: Array.isArray(sale.selectedCategories) ? sale.selectedCategories : [],
      }))
    );

    // --- রিয়েলটাইম ফিউচার ডিউ আপডেট ---
    // প্রতিটি সেলসম্যানের জন্য, এই তারিখের পরবর্তী সব দিনের prevDue, totalDue, currDue আপডেট করুন
    const uniqueSalesmen = [...new Set(sales.map((s) => s.salesmanId))];
    for (const salesmanId of uniqueSalesmen) {
      await recalculateFutureDues(salesmanId, date);
    }

    // --- Emit socket event to all clients ---
    const io = req.app.get("io");
    io.emit("daily-sale-updated", { date });

    res.status(201).json({ message: "Daily sales saved" });
  } catch (err) {
    res.status(500).json({ error: "Failed to save daily sales" });
  }
});

// Helper: recalculate all future daily sales for a salesman after a given date
async function recalculateFutureDues(salesmanId, fromDate) {
  // Find all future sales for this salesman, ordered by date ascending
  const futureSales = await dailySalesCollection
    .find({ salesmanId, date: { $gt: fromDate } })
    .sort({ date: 1 })
    .toArray();

  let prevDue = null;
  // Get the currDue of the last saved day (fromDate)
  const lastDay = await dailySalesCollection.findOne({ salesmanId, date: fromDate });
  if (lastDay) {
    prevDue = lastDay.currDue ?? lastDay.currentDue ?? lastDay.due ?? 0;
  } else {
    // If not found, get the last known due before fromDate
    const last = await dailySalesCollection
      .find({ salesmanId, date: { $lt: fromDate } })
      .sort({ date: -1 })
      .limit(1)
      .toArray();
    prevDue = last[0]?.currDue ?? 0;
  }

  for (const sale of futureSales) {
    // recalculate prevDue, totalDue, currDue
    const categories = Array.isArray(sale.categories) ? sale.categories : [];
    const totalAmount = categories.reduce((sum, c) => sum + (Number(c.total) || 0), 0);
    const deposit = Number(sale.deposit) || 0;
    const newPrevDue = Number(prevDue) || 0;
    const totalDue = totalAmount + newPrevDue;
    const currDue = totalDue - deposit;

    await dailySalesCollection.updateOne(
      { _id: sale._id },
      {
        $set: {
          prevDue: newPrevDue,
          totalAmount: Number(totalAmount.toFixed(2)),
          totalDue: Number(totalDue.toFixed(2)),
          currDue: Number(currDue.toFixed(2)),
        },
      }
    );
    prevDue = currDue;
  }
}

// Keep GET /api/daily-sale/:date for reading only
app.get("/api/daily-sale/:date", async (req, res) => {
  try {
    const date = req.params.date;
    // Get all salesmen
    const allSalesmen = await salesmenCollection.find().toArray();

    // Get all sales for this date
    const docs = await dailySalesCollection.find({ date }).toArray();
    const salesMap = {};
    docs.forEach((sale) => {
      salesMap[sale.salesmanId] = sale;
    });

    // Get previous day's sales for prevDue fallback
    const prevDate = (() => {
      const d = new Date(date);
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    const prevDocs = await dailySalesCollection.find({ date: prevDate }).toArray();
    const prevDueMap = {};
    prevDocs.forEach((sale) => {
      prevDueMap[sale.salesmanId] = sale.currDue ?? sale.currentDue ?? sale.due ?? 0;
    });

    // Helper: get last known due before current date
    const getLastKnownDue = async (salesmanId) => {
      const last = await dailySalesCollection
        .find({ salesmanId, date: { $lt: date } })
        .sort({ date: -1 })
        .limit(1)
        .toArray();
      return last[0]?.currDue ?? 0;
    };

    const finalDocs = [];

    for (const sm of allSalesmen) {
      const today = salesMap[sm._id];
      if (today) {
        // If prevDue is missing/empty/zero, fill from prevDueMap
        if (
          today.prevDue === undefined ||
          today.prevDue === null ||
          today.prevDue === "" ||
          Number(today.prevDue) === 0
        ) {
          today.prevDue = prevDueMap[sm._id] ?? 0;
        }
        // Always include selectedCategories in response
        today.selectedCategories = Array.isArray(today.selectedCategories)
          ? today.selectedCategories
          : [];
        finalDocs.push(today);
      } else {
        // No entry for this salesman today: fallback to prev or last known due
        const fallbackDue = prevDueMap[sm._id] ?? (await getLastKnownDue(sm._id));
        finalDocs.push({
          salesmanId: sm._id,
          date,
          categories: [],
          totalAmount: 0,
          deposit: 0,
          prevDue: fallbackDue,
          totalDue: fallbackDue,
          currDue: fallbackDue,
          selectedCategories: [], // <-- default empty
        });
      }
    }

    res.json(finalDocs);
  } catch {
    res.status(500).json({ error: "Failed to fetch daily sales" });
  }
});

// --- Items Search API ---
app.get("/api/items/search", async (req, res) => {
  try {
    const { query } = req.query;
    let searchQuery = {};
    if (query) {
      searchQuery = { name: { $regex: query, $options: "i" } };
    }
    const items = await itemsCollection.find(searchQuery).sort({ _id: -1 }).toArray();
    items.forEach((item) => { if (item.price === undefined) item.price = ""; });
    res.json({ items });
  } catch {
    res.status(500).json({ error: "Failed to search items" });
  }
});

// --- Ingredients Search API ---
app.get("/api/ingredients/search", async (req, res) => {
  try {
    const { query } = req.query;
    let searchQuery = {};
    if (query) {
      searchQuery = { name: { $regex: query, $options: "i" } };
    }
    const ingredients = await ingredientsCollection.find(searchQuery).sort({ _id: -1 }).toArray();
    ingredients.forEach((ing) => { if (ing.price === undefined) ing.price = ""; });
    res.json({ ingredients });
  } catch {
    res.status(500).json({ error: "Failed to search ingredients" });
  }
});

// --- Salesmen Search API ---
app.get("/api/salesmen/search", async (req, res) => {
  try {
    const { query } = req.query;
    let searchQuery = {};
    if (query) {
      searchQuery = { name: { $regex: query, $options: "i" } };
    }
    const salesmen = await salesmenCollection.find(searchQuery).sort({ _id: 1 }).toArray();
    res.json({ salesmen });
  } catch {
    res.status(500).json({ error: "Failed to search salesmen" });
  }
});

// Start server
server.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
