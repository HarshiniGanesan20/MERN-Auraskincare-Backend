const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const Razorpay = require("razorpay");
const crypto = require("crypto");



require("dotenv").config();


const app = express();
app.use(express.json());
app.use(cors());


const MONGO_URI = `mongodb+srv://${process.env.VITE_MONGO_USERNAME}:${process.env.VITE_MONGO_PASSWORD}@${process.env.VITE_MONGO_CLUSTER}/${process.env.VITE_MONGO_DB_NAME}?retryWrites=true&w=majority&appName=Cluster0`;

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log("DB Connected Successfully");
    })
    .catch((error) => {
        console.error("DB Connection Failed:", error.message);
    });

//products schema

const productSchema = new mongoose.Schema({
    name: String,
    category: String,
    price: String,
    regularPrice: String,
    discount: String,
    soldOut: Boolean,
    img: String,
});


const Product = mongoose.model("Product", productSchema, "products");


app.get("/products", async (req, res) => {
    try {
        const products = await Product.find();
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.get("/products/:id", async (req, res) => {
    try {
        const productId = new mongoose.Types.ObjectId(req.params.id);
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ message: "Product not found" });
        }
        res.json(product);
    } catch (err) {
        res.status(500).json({ error: "Invalid Product ID" });
    }
});


// add new product 

app.post("/add-product", async (req, res) => {
    try {
        const { img, name, category, price, regularPrice, discount, soldOut } = req.body;

        // Create a new product
        const newProduct = new Product({
            img,          
            name,
            category,
            price,
            regularPrice, 
            discount,
            soldOut
        });

        // Save to DB
        await newProduct.save();
        res.status(201).json({ message: "Product added successfully!", product: newProduct });
    } catch (err) {
        res.status(500).json({ error: "Error adding product" });
    }
});





// Review Schema
const reviewSchema = new mongoose.Schema({
    img: String,
    name: String,
    location: String,
    review: String,
});


const Review = mongoose.model("Review", reviewSchema, "review");


app.get("/reviews", async (req, res) => {
    try {
        const reviews = await Review.find();
        res.json(reviews);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



// Order Schema
const orderSchema = new mongoose.Schema({
    orderId: String,
    items: [
        {
            productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
            name: String,
            price: Number,
            quantity: Number
        }
    ],
    totalAmount: Number,
    paymentStatus: { type: String, enum: ["Pending", "Paid", "Failed"], default: "Paid" },
    paymentId: String, 
    customer: {
        name: String,
        email: String,
        contact: String
    },
    orderDate: { type: Date, default: Date.now }
});
const Order = mongoose.model("Order", orderSchema, "orders");


// Razorpay Instance
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_SECRET
});


// Create Razorpay Order

app.post("/create-order", async (req, res) => {
    const { amount } = req.body;
    const options = {
        amount: amount * 100,
        currency: "INR",
        receipt: `receipt_${Date.now()}`
    };
    try {
        const order = await razorpay.orders.create(options);
        res.json(order);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});



// Verify Razorpay Payment

app.post("/verify-payment", async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const secret = process.env.RAZORPAY_SECRET;

        if (!secret) throw new Error("RAZORPAY_SECRET is missing. Check your .env file!");

        const generated_signature = crypto
            .createHmac("sha256", secret)
            .update(razorpay_order_id + "|" + razorpay_payment_id)
            .digest("hex");

        if (generated_signature === razorpay_signature) {
            res.json({ success: true, message: "Payment verified successfully" });
        } else {
            res.status(400).json({ success: false, message: "Payment verification failed" });
        }
    } catch (error) {
        console.error("Payment verification error:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});


// store order details

app.post("/store-order", async (req, res) => {
    try {
        const { orderId, products, totalAmount, customer, paymentId } = req.body;

        if (!orderId || !products || !totalAmount || !customer || !paymentId) {
            console.log("Missing required fields:", req.body);
            return res.status(400).json({ error: "Missing required fields" });
        }

        console.log("Received order data:", req.body);

        const parsePrice = (priceString) => {
            if (typeof priceString === "number") {
                return priceString; 
            }
            if (!priceString || typeof priceString !== "string") {
                console.log("Invalid price string:", priceString);
                return 0; 
            }
        
            const numericValue = Number(priceString.replace(/[^0-9.]/g, "")); 
            return isNaN(numericValue) ? 0 : numericValue; 
        };
        
        // Process order items
        const processedItems = products.map((p) => ({
            productId: p._id,
            name: p.name,
            price: parsePrice(p.price), 
            quantity: p.quantity,
        }));

        // Save order
        const order = new Order({
            orderId,
            items: processedItems, 
            totalAmount: parsePrice(totalAmount),
            paymentStatus: "Paid",
            paymentId,
            customer,
            orderDate: new Date(),
        });

        console.log("Saving order:", order);
        await order.save();
        console.log("Order saved successfully!");

        res.status(201).json({ message: "Order stored successfully!", order });
    } catch (error) {
        console.error("Error storing order:", error);
        res.status(500).json({ error: "Error storing order" });
    }
});


// fetch order history

app.get("/get-orders", async (req, res) => {
    try {
        const { email } = req.query;
        if (!email) return res.status(400).json({ error: "Email is required" });

        const orders = await Order.find({ "customer.email": email });
        if (!orders.length) {
            return res.status(404).json({ error: "No orders found for this email" });
        }

        res.json(orders);
    } catch (error) {
        console.error("Error fetching orders:", error);
        res.status(500).json({ error: "Internal server error. Please try again later." });
    }
});




// User Schema
const userSchema = new mongoose.Schema({
    username: String,
    email: { type: String, unique: true },
    password: String,
    googleAuth: { type: Boolean, default: false }
});

const User = mongoose.model("User", userSchema, "users");

// Save user after signup
app.post("/signup", async (req, res) => {
    const { username, email, password, googleAuth } = req.body;

    try {
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ message: "User already exists" });
        }

        user = new User({ username, email, password, googleAuth });
        await user.save();
        res.status(201).json({ message: "User registered successfully" });
    } catch (error) {
        res.status(500).json({ error: "Error saving user" });
    }
});


// Get user name from db
app.get("/user", async (req, res) => {
    try {
        const { email } = req.query;
        if (!email) return res.status(400).json({ error: "Email is required" });

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: "User not found" });

        res.json(user);
    } catch (error) {
        res.status(500).json({ error: "Server error" });
    }
});

app.get("/",(req,res)=>{
    res.send("Connection successful")
})

app.listen(5000, () => console.log("Server running on port 5000"));
