// server.js
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// --- إعداد Express ---
const app = express();
app.use(express.json());

// --- قراءة متغيرات البيئة ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FCM_JSON_PATH = process.env.FCM_SERVICE_ACCOUNT_JSON_PATH;

// --- إعداد Supabase ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- إعداد Firebase Admin ---
const serviceAccount = JSON.parse(fs.readFileSync(path.resolve(FCM_JSON_PATH), "utf8"));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// --- دالة لإرسال إشعار FCM ---
async function sendFCMNotification(token, title, body, data = {}) {
  if (!token) return;
  const message = {
    token,
    notification: { title, body },
    data,
  };
  try {
    const response = await admin.messaging().send(message);
    console.log("✅ Notification sent:", response);
  } catch (err) {
    console.error("❌ Error sending notification:", err);
  }
}

// --- مراقبة التغييرات في جدول products_comp ---
async function listenProductsComp() {
  const channel = supabase.channel("products_comp_channel")
    .on("postgres_changes", { event: "*", schema: "public", table: "products_comp" }, async (payload) => {
      console.log("🔔 products_comp event:", payload.eventType, payload.new || payload.old);

      // جلب كل العملاء الفعّالين
      const { data: clients, error } = await supabase
        .from("clients")
        .select("fcm_token")
        .in("subscription_status", ["active", "trial"])
        .not("fcm_token", "is", null);

      if (error) return console.error(error);

      // إعداد الرسالة
      let title = "تحديث المنتجات";
      let body = "";
      switch (payload.eventType) {
        case "INSERT":
          body = `تمت إضافة منتج: ${payload.new.product_name}`;
          break;
        case "UPDATE":
          body = `تم تعديل المنتج: ${payload.new.product_name}`;
          break;
        case "DELETE":
          body = `تم حذف المنتج: ${payload.old.product_name}`;
          break;
      }

      // إرسال الإشعارات لكل عميل
      for (const client of clients) {
        await sendFCMNotification(client.fcm_token, title, body, {
          type: "products_comp",
          action: payload.eventType,
        });
      }
    })
    .subscribe();

  console.log("👂 Listening for changes on products_comp...");
}

// --- مراقبة التغييرات في جدول companies ---
async function listenCompanies() {
  const channel = supabase.channel("companies_channel")
    .on("postgres_changes", { event: "*", schema: "public", table: "companies" }, async (payload) => {
      console.log("🔔 companies event:", payload.eventType, payload.new || payload.old);

      const { data: clients, error } = await supabase
        .from("clients")
        .select("fcm_token")
        .in("subscription_status", ["active", "trial"])
        .not("fcm_token", "is", null);

      if (error) return console.error(error);

      let title = "تحديث الشركات";
      let body = "";
      switch (payload.eventType) {
        case "INSERT":
          body = `تمت إضافة شركة: ${payload.new.company_name}`;
          break;
        case "UPDATE":
          body = `تم تعديل الشركة: ${payload.new.company_name}`;
          break;
        case "DELETE":
          body = `تم حذف الشركة: ${payload.old.company_name}`;
          break;
      }

      for (const client of clients) {
        await sendFCMNotification(client.fcm_token, title, body, {
          type: "companies",
          action: payload.eventType,
        });
      }
    })
    .subscribe();

  console.log("👂 Listening for changes on companies...");
}

// --- تشغيل السيرفر ---
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Server is running"));
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await listenProductsComp();
  await listenCompanies();
});
