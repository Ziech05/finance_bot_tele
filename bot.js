require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const { google } = require("googleapis");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");
const cron = require("node-cron");
const fs = require("fs");

const USER_FILE = "users.json";

function loadUsers() {
  if (!fs.existsSync(USER_FILE)) return [];
  return JSON.parse(fs.readFileSync(USER_FILE));
}

function saveUsers(users) {
  fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2));
}

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const ADMIN_ID = 960957528;

const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

// FIX newline
credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");

const auth = new google.auth.GoogleAuth({
  credentials: credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

async function tambahData(tanggal, jenis, jumlah, kategori, keterangan) {
  const client = await auth.getClient();

  const sheets = google.sheets({
    version: "v4",
    auth: client,
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: "Sheet1!A:E",
    valueInputOption: "USER_ENTERED",
    resource: {
      values: [[tanggal, jenis, jumlah, kategori, keterangan]],
    },
  });
}

async function ambilData() {
  const client = await auth.getClient();

  const sheets = google.sheets({
    version: "v4",
    auth: client,
  });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: "Sheet1!A:E",
  });

  return res.data.values || [];
}

console.log(credentials.client_email);
bot.sendMessage(ADMIN_ID, "Bot finance recorder berhasil dijalankan");

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  try {
    // =====================
    // INPUT PEMASUKAN
    // =====================

    if (text.startsWith("/masuk")) {
      const data = text.split(" ");

      if (data.length < 4) {
        return bot.sendMessage(
          chatId,
          `Format salah

Contoh:
/masuk 500000 gaji freelance`,
        );
      }

      const jumlah = data[1];
      const kategori = data[2];
      const ket = data.slice(3).join(" ");
      const tanggal = new Date().toISOString().split("T")[0];

      await tambahData(tanggal, "Pemasukan", jumlah, kategori, ket);

      bot.sendMessage(chatId, "Pemasukan berhasil dicatat");
    }

    // =====================
    // INPUT PENGELUARAN
    // =====================

    if (text.startsWith("/keluar")) {
      const data = text.split(" ");

      if (data.length < 4) {
        return bot.sendMessage(
          chatId,
          `Format salah

Contoh:
/keluar 20000 makan nasi goreng`,
        );
      }

      const jumlah = data[1];
      const kategori = data[2];
      const ket = data.slice(3).join(" ");
      const tanggal = new Date().toLocaleDateString();

      await tambahData(tanggal, "Pengeluaran", jumlah, kategori, ket);

      bot.sendMessage(chatId, "Pengeluaran berhasil dicatat");
    }

    // =====================
    // PARSING CEPAT +
    // =====================

    if (text.startsWith("+")) {
      const data = text.split(" ");

      const jumlah = data[0].replace("+", "");
      const ket = data.slice(1).join(" ");

      const tanggal = new Date().toLocaleDateString();

      await tambahData(tanggal, "Pemasukan", jumlah, "lainnya", ket);

      bot.sendMessage(chatId, "Pemasukan dicatat");
    }

    // =====================
    // PARSING CEPAT -
    // =====================

    if (text.startsWith("-")) {
      const data = text.split(" ");

      const jumlah = data[0].replace("-", "");
      const ket = data.slice(1).join(" ");

      const tanggal = new Date().toLocaleDateString();

      await tambahData(tanggal, "Pengeluaran", jumlah, "lainnya", ket);

      bot.sendMessage(chatId, "Pengeluaran dicatat");
    }
  } catch (error) {
    console.error(error);

    bot.sendMessage(ADMIN_ID, "ERROR BOT:\n" + error.message);

    bot.sendMessage(chatId, "Terjadi error saat menyimpan data.");
  }
});

// =====================
// STATUS BOT
// =====================

bot.onText(/\/status/, (msg) => {
  bot.sendMessage(msg.chat.id, "Bot aktif dan berjalan normal");
});

// =====================
// SALDO
// =====================

bot.onText(/\/saldo/, async (msg) => {
  const chatId = msg.chat.id;

  const rows = await ambilData();

  let pemasukan = 0;
  let pengeluaran = 0;

  rows.slice(1).forEach((row) => {
    const jenis = row[1];
    const jumlah = parseInt(row[2]) || 0;

    if (jenis === "Pemasukan") pemasukan += jumlah;
    if (jenis === "Pengeluaran") pengeluaran += jumlah;
  });

  const saldo = pemasukan - pengeluaran;

  bot.sendMessage(
    chatId,
    `Saldo Saat Ini

Pemasukan : ${pemasukan}
Pengeluaran : ${pengeluaran}

Saldo : ${saldo}`,
  );
});

// =====================
// LAPORAN HARIAN
// =====================

bot.onText(/\/laporan_hari/, async (msg) => {
  const chatId = msg.chat.id;

  const rows = await ambilData();

  const today = new Date().toLocaleDateString();

  let pemasukan = 0;
  let pengeluaran = 0;

  rows.slice(1).forEach((row) => {
    const tanggal = row[0];
    const jenis = row[1];
    const jumlah = parseInt(row[2]);

    if (tanggal === today) {
      if (jenis === "Pemasukan") pemasukan += jumlah;
      if (jenis === "Pengeluaran") pengeluaran += jumlah;
    }
  });

  bot.sendMessage(
    chatId,
    `Laporan Hari Ini

Pemasukan : ${pemasukan}
Pengeluaran : ${pengeluaran}

Saldo : ${pemasukan - pengeluaran}`,
  );
});

// =====================
// LAPORAN BULANAN
// =====================

bot.onText(/\/laporan_bulan/, async (msg) => {
  const chatId = msg.chat.id;

  const rows = await ambilData();

  const now = new Date();

  const bulan = now.getMonth() + 1;
  const tahun = now.getFullYear();

  let pemasukan = 0;
  let pengeluaran = 0;

  rows.slice(1).forEach((row) => {
    const t = new Date(row[0]);

    if (t.getMonth() + 1 === bulan && t.getFullYear() === tahun) {
      const jenis = row[1];
      const jumlah = parseInt(row[2]);

      if (jenis === "Pemasukan") pemasukan += jumlah;
      if (jenis === "Pengeluaran") pengeluaran += jumlah;
    }
  });

  bot.sendMessage(
    chatId,
    `Laporan Bulan Ini

Pemasukan : ${pemasukan}
Pengeluaran : ${pengeluaran}

Saldo : ${pemasukan - pengeluaran}`,
  );
});

// =====================
// LAPORAN TAHUNAN
// =====================

bot.onText(/\/laporan_tahun/, async (msg) => {
  const chatId = msg.chat.id;

  const rows = await ambilData();

  const tahun = new Date().getFullYear();

  let pemasukan = 0;
  let pengeluaran = 0;

  rows.slice(1).forEach((row) => {
    const t = new Date(row[0]);

    if (t.getFullYear() === tahun) {
      const jenis = row[1];
      const jumlah = parseInt(row[2]);

      if (jenis === "Pemasukan") pemasukan += jumlah;
      if (jenis === "Pengeluaran") pengeluaran += jumlah;
    }
  });

  bot.sendMessage(
    chatId,
    `Laporan Tahun ${tahun}

Pemasukan : ${pemasukan}
Pengeluaran : ${pengeluaran}

Saldo : ${pemasukan - pengeluaran}`,
  );
});

// =====================
// LAPORAN KATEGORI
// =====================

bot.onText(/\/laporan_kategori/, async (msg) => {
  const chatId = msg.chat.id;

  const rows = await ambilData();

  const kategori = {};

  rows.slice(1).forEach((row) => {
    const jenis = row[1];
    const jumlah = parseInt(row[2]);
    const kat = row[3];

    if (jenis === "Pengeluaran") {
      if (!kategori[kat]) kategori[kat] = 0;

      kategori[kat] += jumlah;
    }
  });

  let pesan = "Laporan Pengeluaran per Kategori\n\n";

  for (let k in kategori) {
    pesan += `${k} : ${kategori[k]}\n`;
  }

  bot.sendMessage(chatId, pesan);
});

// =====================
// HELP
// =====================

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;

  const pesan = `Panduan Finance Recorder Bot

INPUT TRANSAKSI

Pemasukan
/masuk jumlah kategori keterangan

Contoh
/masuk 500000 gaji freelance

Pengeluaran
/keluar jumlah kategori keterangan

Contoh
/keluar 20000 makan bakso

INPUT CEPAT

+50000 gaji
-20000 makan

LAPORAN

/saldo
Menampilkan saldo saat ini

/laporan_hari
Laporan transaksi hari ini

/laporan_bulan
Laporan transaksi bulan ini

/laporan_tahun
Laporan transaksi tahun ini

/laporan_kategori
Total pengeluaran per kategori

FITUR TAMBAHAN

/grafik
Menampilkan grafik pengeluaran

/export_excel
Export laporan ke Excel

/export_pdf
Export laporan ke PDF

ADMIN
/users
Melihat jumlah pengguna bot

/status
Cek status bot

/help
Menampilkan panduan bot`;

  bot.sendMessage(chatId, pesan);
});

process.on("uncaughtException", (error) => {
  console.error(error);

  bot.sendMessage(ADMIN_ID, "CRITICAL ERROR:\n" + error);
});

bot.onText(/\/start/, (msg) => {
  const nama = msg.from.first_name || "User";
  const userId = msg.from.id;

  let users = loadUsers();

  if (!users.includes(userId)) {
    users.push(userId);
    saveUsers(users);

    bot.sendMessage(
      ADMIN_ID,
      `User baru menggunakan bot

Nama : ${nama}
Username : @${msg.from.username || "-"}
ID : ${userId}

Total user sekarang : ${users.length}`,
    );
  }

  bot.sendMessage(
    msg.chat.id,
    `Halo ${nama}

Selamat datang di Finance Recorder Bot

Contoh cepat:

+50000 gaji
-20000 makan

Ketik /help untuk melihat command.`,
  );
});

bot.onText(/\/export_excel/, async (msg) => {
  const rows = await ambilData();

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Laporan");

  rows.forEach((r) => sheet.addRow(r));

  const file = "laporan_keuangan.xlsx";

  await workbook.xlsx.writeFile(file);

  bot.sendDocument(msg.chat.id, file);
});

bot.onText(/\/export_pdf/, async (msg) => {
  const rows = await ambilData();

  const file = "laporan.pdf";

  const doc = new PDFDocument();

  doc.pipe(fs.createWriteStream(file));

  doc.fontSize(18).text("Laporan Keuangan", { align: "center" });

  doc.moveDown();

  rows.forEach((row) => {
    doc.text(row.join(" | "));
  });

  doc.end();

  setTimeout(() => {
    bot.sendDocument(msg.chat.id, file);
  }, 2000);
});

bot.onText(/\/grafik/, async (msg) => {
  const rows = await ambilData();

  const kategori = {};

  rows.slice(1).forEach((row) => {
    if (row[1] === "Pengeluaran") {
      const kat = row[3];
      const jumlah = parseInt(row[2]) || 0;

      if (!kategori[kat]) kategori[kat] = 0;

      kategori[kat] += jumlah;
    }
  });

  const width = 800;
  const height = 600;

  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

  const config = {
    type: "pie",
    data: {
      labels: Object.keys(kategori),
      datasets: [
        {
          data: Object.values(kategori),
        },
      ],
    },
  };

  const image = await chartJSNodeCanvas.renderToBuffer(config);

  fs.writeFileSync("grafik.png", image);

  bot.sendPhoto(msg.chat.id, "grafik.png");
});

bot.onText(/\/users/, (msg) => {
  if (msg.from.id !== ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, "Command hanya untuk admin");
  }

  const users = loadUsers();

  bot.sendMessage(
    msg.chat.id,
    `Statistik Bot

Total pengguna : ${users.length}`,
  );
});

cron.schedule("0 0 * * *", async () => {
  const rows = await ambilData();

  const file = `backup_${Date.now()}.json`;

  fs.writeFileSync(file, JSON.stringify(rows));

  bot.sendMessage(ADMIN_ID, "Backup data berhasil dibuat");
});
