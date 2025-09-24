// server.js
import express from "express";
import { createClient } from "@supabase/supabase-js";
import admin from "firebase-admin";
import fs from "fs";

// ==== إعداد البيئة ====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FCM_SERVICE_ACCOUNT_JSON_PATH = "/etc/secrets/serviceAccount.json";



if (!SUPABASE_URL || !SUPABASE_KEY || !FCM_SERVICE_ACCOUNT_JSON_PATH) {
  throw new Error("Please set SUPABASE_URL, SUPABASE_KEY, FCM_SERVICE_ACCOUNT_JSON_PATH");
}

// ==== تهيئة Supabase ====
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==== تهيئة Firebase Admin ====
const serviceAccount = JSON.parse(fs.readFileSync(FCM_SERVICE_ACCOUNT_JSON_PATH, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ==== إنشاء سيرفر Express ====
const app = express();
app.use(express.json());

// ==== دالة لإرسال إشعارات لكل عملاء فعالين ====
async function sendNotification(title, body, data = {}) {
  try {
    const { data: clients, error } = await supabase
      .from("clients")
      .select("fcm_token")
      .in("subscription_status", ["active", "trial"])
      .not("fcm_token", "is", null);

    if (error) {
      console.error("Error fetching clients:", error);
      return;
    }

    if (!clients || clients.length === 0) {
      console.log("No clients found with FCM tokens.");
      return;
    }

    // طباعة جميع التوكنات للتأكد
    console.log("Tokens to send notifications to:", clients.map(c => c.fcm_token));

    // إرسال الإشعارات لكل عميل
    for (const client of clients) {
      if (!client.fcm_token) continue;

try {
  const response = await admin.messaging().send({
    notification: { title, body },
    token: client.fcm_token,
    data,
  });
  console.log("Successfully sent message:", response);
} catch (err) {
  if (err.code === 'messaging/registration-token-not-registered') {
    console.log(`Token no longer valid, removing from database: ${client.fcm_token}`);
    // حذف التوكن من قاعدة البيانات
    await supabase
      .from('clients')
      .update({ fcm_token: null })
      .eq('fcm_token', client.fcm_token);
  } else {
    console.error("Error sending message to token:", client.fcm_token, err);
  }
}

  } catch (err) {
    console.error("Error sending notification:", err);
  }
}

// ==== الاشتراك في Realtime لجدول products_comp ====
const productChannel = supabase.channel("realtime-products")
  .on("postgres_changes", { event: "*", schema: "public", table: "products_comp" }, async (payload) => {
    console.log("🔔 Event products_comp received:", payload);

    const action = payload.eventType; // INSERT, UPDATE, DELETE
    const product_name = payload.new?.product_name ?? payload.old?.product_name ?? "منتج";

    await sendNotification(
      action === "INSERT" ? "تم إضافة منتج" : action === "UPDATE" ? "تم تحديث منتج" : "تم حذف منتج",
      `${product_name} تم ${action.toLowerCase()}`,
      { type: "product_update", action, product_name }
    );
  })
  .subscribe();

// ==== الاشتراك في Realtime لجدول companies ====
const companyChannel = supabase.channel("realtime-companies")
  .on("postgres_changes", { event: "*", schema: "public", table: "companies" }, async (payload) => {
    console.log("🔔 Event companies received:", payload);

    const action = payload.eventType;
    const company_name = payload.new?.company_name ?? payload.old?.company_name ?? "شركة";

    await sendNotification(
      action === "INSERT" ? "تم إضافة شركة" : action === "UPDATE" ? "تم تحديث شركة" : "تم حذف شركة",
      `${company_name} تم ${action.toLowerCase()}`,
      { type: "company_update", action, company_name }
    );
  })
  .subscribe();

// ==== Endpoint بسيط للتأكد أن السيرفر يعمل ====
app.get("/", (_req, res) => {
  res.send("Server is running and listening for changes on products_comp and companies.");
});

// ==== تشغيل السيرفر ====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});




