// PUBG UC Bot - Node.js Telegram Bot
// Language: Uzbek (Latin)
// Single file: bot.js

const { Telegraf, Markup, session } = require('telegraf');
const mongoose = require('mongoose');

// ========================
// CONFIGURATION
// ========================
const BOT_TOKEN = process.env.BOT_TOKEN || '7412314295:AAHYB804OToAPUQiC-b6Ma6doBtMCHETmQU';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://abumafia0:abumafia0@abumafia.h1trttg.mongodb.net/ucbot?retryWrites=true&w=majority';
const ADMIN_IDS = (process.env.ADMIN_IDS || '6606638731').split(',').map(id => parseInt(id.trim())).filter(id => id);
const ADMIN_PHONE = process.env.ADMIN_PHONE || '+998914703008';
const ADMIN_CARD = process.env.ADMIN_CARD || '5614688705202686';

// ========================
// MONGODB SCHEMAS
// ========================

// MongoDB connection
mongoose.connect(MONGODB_URI).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// User Schema
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  username: String,
  firstName: String,
  lastName: String,
  balanceUC: { type: Number, default: 0 },
  referralEarnings: { type: Number, default: 0 },
  referredBy: { type: Number, default: null },
  referralsCount: { type: Number, default: 0 },
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// Payment Schema
const paymentSchema = new mongoose.Schema({
  userId: { type: Number, required: true },
  username: String,
  amountUC: { type: Number, required: true },
  amountSoom: { type: Number, required: true },
  screenshot: String, // File ID from Telegram
  screenshotMessageId: Number,
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  adminNote: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Contest Schema
const contestSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  prize: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  participants: [{ type: Number }], // Array of user IDs
  winnerId: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now },
  endsAt: Date
});

// Shop Order Schema
const shopOrderSchema = new mongoose.Schema({
  userId: { type: Number, required: true },
  username: String,
  itemName: { type: String, required: true },
  itemDescription: String,
  priceUC: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'processing', 'completed', 'cancelled'],
    default: 'pending'
  },
  createdAt: { type: Date, default: Date.now }
});

// Create models
const User = mongoose.model('User', userSchema);
const Payment = mongoose.model('Payment', paymentSchema);
const Contest = mongoose.model('Contest', contestSchema);
const ShopOrder = mongoose.model('ShopOrder', shopOrderSchema);

// ========================
// BOT INITIALIZATION
// ========================
const bot = new Telegraf(BOT_TOKEN);

// Session middleware - to'lov jarayonini kuzatish uchun
bot.use(session());

// ========================
// STATE MANAGEMENT
// ========================
// To'lov jarayonidagi foydalanuvchilarni kuzatish
const paymentState = new Map(); // userId -> { amountUC, amountSoom }

// ========================
// KEYBOARD MENUS
// ========================

// Main menu keyboard
const mainMenuKeyboard = Markup.keyboard([
  ['🎮 Balansim', '➕ Add Funds'],
  ['🛒 UC Shop', '👥 Referral'],
  ['🏆 Konkurslar', 'ℹ️ Yordam']
]).resize();

// Admin menu keyboard
const adminMenuKeyboard = Markup.keyboard([
  ['📊 Statistika', '📢 Xabar yuborish'],
  ['💰 To\'lovlar', '🏆 Konkurs boshqaruvi'],
  ['👥 Foydalanuvchilar', '🔙 Asosiy menyu']
]).resize();

// UC Packages for Add Funds
const ucPackages = [
  { label: '30 UC', value: 30, price: 7000 },
  { label: '60 UC', value: 60, price: 14000 },
  { label: '120 UC', value: 120, price: 28000 },
  { label: '240 UC', value: 240, price: 56000 },
  { label: '360 UC', value: 360, price: 84000 },
  { label: '720 UC', value: 720, price: 168000 },
  { label: '1440 UC', value: 1440, price: 336000 }
];

// UC Shop Items
const shopItems = [
  { id: 1, name: '30 UC PUBG buyurtmasi', description: '30 UC PUBG hisobingizga qo\'shiladi', price: 30 },
  { id: 2, name: '60 UC PUBG buyurtmasi', description: '60 UC PUBG hisobingizga qo\'shiladi', price: 60 },
  { id: 3, name: '120 UC PUBG buyurtmasi', description: '120 UC PUBG hisobingizga qo\'shiladi', price: 120 },
  { id: 4, name: '240 UC PUBG buyurtmasi', description: '240 UC PUBG hisobingizga qo\'shiladi', price: 240 },
  { id: 5, name: '360 UC PUBG buyurtmasi', description: '360 UC PUBG hisobingizga qo\'shiladi', price: 360 }
];

// ========================
// HELPER FUNCTIONS
// ========================

// Get or create user
async function getUser(telegramId, username, firstName, lastName) {
  let user = await User.findOne({ telegramId });
  if (!user) {
    user = new User({
      telegramId,
      username,
      firstName,
      lastName,
      isAdmin: ADMIN_IDS.includes(telegramId)
    });
    await user.save();
  }
  return user;
}

// Update user balance
async function updateUserBalance(userId, amount) {
  const user = await User.findOneAndUpdate(
    { telegramId: userId },
    { $inc: { balanceUC: amount } },
    { new: true }
  );
  return user;
}

// Get referral stats
async function getReferralStats(userId) {
  const user = await User.findOne({ telegramId: userId });
  if (!user) return null;
  
  const referrals = await User.find({ referredBy: userId });
  const totalEarned = user.referralEarnings || 0;
  
  return {
    count: referrals.length,
    earned: totalEarned
  };
}

// Format number with commas
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Create new payment record
async function createPayment(userId, username, amountUC, amountSoom, screenshot = null) {
  const payment = new Payment({
    userId,
    username,
    amountUC,
    amountSoom,
    screenshot,
    status: 'pending'
  });
  await payment.save();
  return payment;
}

// ========================
// COMMAND HANDLERS
// ========================

// Start command with referral system
bot.start(async (ctx) => {
  const { id, username, first_name, last_name } = ctx.from;
  
  // Check for referral
  let referredBy = null;
  const startPayload = ctx.startPayload;
  
  if (startPayload && startPayload.startsWith('ref_')) {
    const referrerId = parseInt(startPayload.replace('ref_', ''));
    if (referrerId && referrerId !== id) {
      referredBy = referrerId;
      
      // Give referral bonuses (if not already referred)
      const existingUser = await User.findOne({ telegramId: id });
      if (!existingUser) {
        // New user bonus
        await updateUserBalance(id, 1);
        
        // Referrer bonus
        await updateUserBalance(referredBy, 3);
        
        // Update referral counts
        await User.findOneAndUpdate(
          { telegramId: referredBy },
          { 
            $inc: { 
              referralsCount: 1,
              referralEarnings: 3
            }
          }
        );
      }
    }
  }
  
  // Get or create user
  const user = await getUser(id, username, first_name, last_name);
  
  // Set referredBy if it's a new user with referral
  if (referredBy && !user.referredBy) {
    user.referredBy = referredBy;
    await user.save();
  }
  
  const welcomeText = `🎮 *PUBG UC Botiga xush kelibsiz!*\n\n` +
    `Balansingiz: *${user.balanceUC} UC*\n` +
    `Takliflar: *${user.referralsCount} ta*\n\n` +
    `Quyidagi menyudan kerakli bo'limni tanlang:`;
  
  await ctx.replyWithMarkdown(welcomeText, mainMenuKeyboard);
});

// Main menu handlers
bot.hears('🎮 Balansim', async (ctx) => {
  const userId = ctx.from.id;
  const user = await User.findOne({ telegramId: userId });
  const stats = await getReferralStats(userId);
  
  const balanceText = `💰 *Balans ma'lumotlari*\n\n` +
    `Joriy balans: *${user.balanceUC} UC*\n` +
    `Takliflar soni: *${stats?.count || 0} ta*\n` +
    `Taklifdan topilgan: *${stats?.earned || 0} UC*\n\n` +
    `Hisobingizni to'ldirish uchun *➕ Add Funds* bo'limidan foydalaning.`;
  
  await ctx.replyWithMarkdown(balanceText);
});

bot.hears('➕ Add Funds', async (ctx) => {
  const inlineKeyboard = Markup.inlineKeyboard(
    ucPackages.map(pkg => [
      Markup.button.callback(
        `${pkg.label} - ${formatNumber(pkg.price)} so'm`,
        `addfunds_${pkg.value}`
      )
    ])
  );
  
  await ctx.reply(
    '💳 *UC Paketlarini tanlang:*\n\n' +
    'Har bir 30 UC = 7,000 so\'m\n' +
    'To\'lov: Click, Payme, bank kartasi\n\n' +
    'Kerakli paketni tanlang:',
    {
      parse_mode: 'Markdown',
      ...inlineKeyboard
    }
  );
});

bot.hears('🛒 UC Shop', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  const inlineKeyboard = Markup.inlineKeyboard(
    shopItems.map(item => [
      Markup.button.callback(
        `${item.name} - ${item.price} UC`,
        `shop_${item.id}`
      )
    ])
  );
  
  await ctx.reply(
    `🛒 *UC Shop*\n\n` +
    `Joriy balans: *${user.balanceUC} UC*\n\n` +
    `Quyidagi mahsulotlardan birini tanlang:`,
    {
      parse_mode: 'Markdown',
      ...inlineKeyboard
    }
  );
});

bot.hears('👥 Referral', async (ctx) => {
  const userId = ctx.from.id;
  const user = await User.findOne({ telegramId: userId });
  const stats = await getReferralStats(userId);
  
  const botUsername = ctx.botInfo.username;
  const referralLink = `https://t.me/${botUsername}?start=ref_${userId}`;
  
  const referralText = `👥 *Referral tizimi*\n\n` +
    `Takliflar soni: *${stats?.count || 0} ta*\n` +
    `Taklifdan topilgan: *${stats?.earned || 0} UC*\n\n` +
    `*Har bir taklif uchun:*\n` +
    `• Siz: *3 UC* olasiz\n` +
    `• Do'stingiz: *1 UC* oladi\n\n` +
    `💎 *Sizning taklif havolangiz:*\n\`${referralLink}\`\n\n` +
    `Havolani nusxalash uchun ustiga bosing.`;
  
  await ctx.replyWithMarkdown(referralText);
});

bot.hears('🏆 Konkurslar', async (ctx) => {
  const activeContests = await Contest.find({ isActive: true });
  
  if (activeContests.length === 0) {
    await ctx.reply('🏆 Hozirda faol konkurslar mavjud emas.');
    return;
  }
  
  let contestsText = '🏆 *Faol konkurslar:*\n\n';
  
  for (const contest of activeContests) {
    const participantsCount = contest.participants ? contest.participants.length : 0;
    contestsText += `*${contest.title}*\n` +
      `${contest.description || ''}\n` +
      `💰 Mukofot: ${contest.prize}\n` +
      `👥 Ishtirokchilar: ${participantsCount} ta\n\n`;
  }
  
  await ctx.replyWithMarkdown(contestsText);
});

bot.hears('ℹ️ Yordam', async (ctx) => {
  const helpText = `ℹ️ *Yordam va qo'llanma*\n\n` +
    `*1. Balansim* - UC balansingizni ko'rish\n` +
    `*2. Add Funds* - Hisobingizni to'ldirish\n` +
    `*3. UC Shop* - UC xarid qilish\n` +
    `*4. Referral* - Do'stlarni taklif qilish\n` +
    `*5. Konkurslar* - Faol konkurslar\n\n` +
    `📞 *Admin bilan aloqa:* ${ADMIN_PHONE}\n\n` +
    `Agar muammo bo'lsa, admin bilan bog'laning.`;
  
  await ctx.replyWithMarkdown(helpText);
});

// ========================
// INLINE BUTTON HANDLERS
// ========================

// Add Funds package selection
bot.action(/addfunds_(\d+)/, async (ctx) => {
  const ucAmount = parseInt(ctx.match[1]);
  const packageInfo = ucPackages.find(p => p.value === ucAmount);
  
  if (!packageInfo) {
    await ctx.answerCbQuery('Paket topilmadi');
    return;
  }
  
  // Saqlab qo'yish to'lov jarayoni uchun
  const userId = ctx.from.id;
  paymentState.set(userId, {
    amountUC: ucAmount,
    amountSoom: packageInfo.price
  });
  
  const paymentInfo = `💳 *To'lov ma'lumotlari*\n\n` +
    `Tanlangan UC: *${ucAmount} UC*\n` +
    `Narxi: *${formatNumber(packageInfo.price)} so'm*\n\n` +
    `💎 *Admin karta raqami:*\n\`${ADMIN_CARD}\`\n\n` +
    `📱 *Admin telefon:* ${ADMIN_PHONE}\n\n` +
    `*To'lov qilgach, chek skrinshotini yuboring.*\n` +
    `Admin tekshirib, UC qo'shadi.\n\n` +
    `ℹ️ Iltimos, faqat skrinshot yuboring.`;
  
  await ctx.editMessageText(paymentInfo, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      Markup.button.callback('🔙 Ortga', 'back_to_packages')
    ])
  });
  
  await ctx.answerCbQuery();
});

// Back to packages
bot.action('back_to_packages', async (ctx) => {
  const inlineKeyboard = Markup.inlineKeyboard(
    ucPackages.map(pkg => [
      Markup.button.callback(
        `${pkg.label} - ${formatNumber(pkg.price)} so'm`,
        `addfunds_${pkg.value}`
      )
    ])
  );
  
  await ctx.editMessageText(
    '💳 *UC Paketlarini tanlang:*\n\n' +
    'Har bir 30 UC = 7,000 so\'m\n' +
    'To\'lov: Click, Payme, bank kartasi\n\n' +
    'Kerakli paketni tanlang:',
    {
      parse_mode: 'Markdown',
      ...inlineKeyboard
    }
  );
  
  await ctx.answerCbQuery();
});

// Shop item selection
bot.action(/shop_(\d+)/, async (ctx) => {
  const itemId = parseInt(ctx.match[1]);
  const item = shopItems.find(i => i.id === itemId);
  const userId = ctx.from.id;
  
  if (!item) {
    await ctx.answerCbQuery('Mahsulot topilmadi');
    return;
  }
  
  const user = await User.findOne({ telegramId: userId });
  
  if (user.balanceUC < item.price) {
    await ctx.answerCbQuery('Balansingizda yetarli UC mavjud emas');
    return;
  }
  
  // Ask for confirmation
  await ctx.editMessageText(
    `🛒 *Buyurtma tasdiqlash*\n\n` +
    `Mahsulot: ${item.name}\n` +
    `Tavsif: ${item.description}\n` +
    `Narxi: ${item.price} UC\n\n` +
    `Joriy balans: ${user.balanceUC} UC\n` +
    `Buyurtma berish uchun tasdiqlang:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Tasdiqlash', `confirm_shop_${itemId}`),
          Markup.button.callback('❌ Bekor qilish', 'cancel_shop')
        ]
      ])
    }
  );
  
  await ctx.answerCbQuery();
});

// Confirm shop order
bot.action(/confirm_shop_(\d+)/, async (ctx) => {
  const itemId = parseInt(ctx.match[1]);
  const item = shopItems.find(i => i.id === itemId);
  const userId = ctx.from.id;
  const user = await User.findOne({ telegramId: userId });
  
  if (!item) {
    await ctx.answerCbQuery('Xatolik yuz berdi');
    return;
  }
  
  // Check balance again
  if (user.balanceUC < item.price) {
    await ctx.editMessageText('❌ Balansingizda yetarli UC mavjud emas');
    return;
  }
  
  // Deduct balance
  await updateUserBalance(userId, -item.price);
  
  // Create order
  const order = new ShopOrder({
    userId,
    username: user.username,
    itemName: item.name,
    itemDescription: item.description,
    priceUC: item.price,
    status: 'pending'
  });
  await order.save();
  
  // Notify admin
  const updatedUser = await User.findOne({ telegramId: userId });
  
  for (const adminId of ADMIN_IDS) {
    try {
      await ctx.telegram.sendMessage(
        adminId,
        `🛒 *Yangi buyurtma!*\n\n` +
        `Foydalanuvchi: @${user.username || 'Noma\'lum'}\n` +
        `ID: ${userId}\n` +
        `Mahsulot: ${item.name}\n` +
        `Tavsif: ${item.description}\n` +
        `Narxi: ${item.price} UC\n` +
        `Buyurtma ID: ${order._id}\n\n` +
        `Foydalanuvchi balansi: ${updatedUser.balanceUC} UC`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error('Adminga xabar yuborishda xatolik:', err);
    }
  }
  
  await ctx.editMessageText(
    `✅ *Buyurtma muvaffaqiyatli berildi!*\n\n` +
    `Mahsulot: ${item.name}\n` +
    `Sarflangan: ${item.price} UC\n` +
    `Yangi balans: ${updatedUser.balanceUC} UC\n\n` +
    `Buyurtma ID: ${order._id}\n` +
    `Admin tez orada siz bilan bog'lanadi.`,
    { parse_mode: 'Markdown' }
  );
  
  await ctx.answerCbQuery();
});

// Cancel shop order
bot.action('cancel_shop', async (ctx) => {
  await ctx.editMessageText('❌ Buyurtma bekor qilindi.');
  await ctx.answerCbQuery();
});

// ========================
// PAYMENT SCREENSHOT HANDLER
// ========================

// Handle photo upload for payment
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const user = await User.findOne({ telegramId: userId });
  
  // Check if user has active payment state
  const paymentData = paymentState.get(userId);
  
  if (!paymentData) {
    // Agar to'lov jarayonida bo'lmasa, oddiy rasm deb hisoblash
    return;
  }
  
  // Get the largest photo file_id
  const photo = ctx.message.photo.pop();
  const fileId = photo.file_id;
  
  // Create payment record in database
  const payment = await createPayment(
    userId,
    user.username || `user_${userId}`,
    paymentData.amountUC,
    paymentData.amountSoom,
    fileId
  );
  
  // Clear payment state
  paymentState.delete(userId);
  
  // Send confirmation to user
  await ctx.reply(
    `✅ Chek qabul qilindi!\n\n` +
    `To'lov ID: ${payment._id}\n` +
    `Miqdor: ${paymentData.amountUC} UC\n` +
    `Summa: ${formatNumber(paymentData.amountSoom)} so'm\n\n` +
    `Admin tekshirib, tez orada UC qo'shadi.`
  );
  
  // Notify all admins with inline buttons for approval
  for (const adminId of ADMIN_IDS) {
    try {
      const message = await ctx.telegram.sendPhoto(
        adminId,
        fileId,
        {
          caption: `📸 *Yangi to'lov cheki!*\n\n` +
            `Foydalanuvchi: @${user.username || 'Noma\'lum'}\n` +
            `ID: ${userId}\n` +
            `Ismi: ${user.firstName || ''} ${user.lastName || ''}\n` +
            `Miqdor: ${paymentData.amountUC} UC\n` +
            `Summa: ${formatNumber(paymentData.amountSoom)} so'm\n` +
            `To'lov ID: ${payment._id}\n\n` +
            `To'lovni tasdiqlang:`,
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Tasdiqlash', `approve_${payment._id}`),
              Markup.button.callback('❌ Rad etish', `reject_${payment._id}`)
            ]
          ])
        }
      );
      
      // Save message ID for payment
      payment.screenshotMessageId = message.message_id;
      await payment.save();
      
    } catch (err) {
      console.error('Adminga chek yuborishda xatolik:', err);
    }
  }
});

// ========================
// ADMIN SYSTEM
// ========================

// Admin command
bot.command('admin', async (ctx) => {
  const userId = ctx.from.id;
  
  if (!ADMIN_IDS.includes(userId)) {
    await ctx.reply('❌ Siz admin emassiz.');
    return;
  }
  
  const adminText = `👨‍💼 *Admin paneli*\n\n` +
    `Quyidagi menyudan kerakli bo'limni tanlang:`;
  
  await ctx.replyWithMarkdown(adminText, adminMenuKeyboard);
});

// Admin menu handlers
bot.hears('📊 Statistika', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  
  try {
    const totalUsers = await User.countDocuments();
    const totalBalance = await User.aggregate([
      { $group: { _id: null, total: { $sum: '$balanceUC' } } }
    ]);
    const totalReferrals = await User.aggregate([
      { $group: { _id: null, total: { $sum: '$referralsCount' } } }
    ]);
    const pendingPayments = await Payment.countDocuments({ status: 'pending' });
    const completedPayments = await Payment.countDocuments({ status: 'approved' });
    
    const statsText = `📊 *Bot statistikasi*\n\n` +
      `Foydalanuvchilar: *${totalUsers} ta*\n` +
      `Jami UC balans: *${totalBalance[0]?.total || 0} UC*\n` +
      `Jami takliflar: *${totalReferrals[0]?.total || 0} ta*\n` +
      `Kutilayotgan to'lovlar: *${pendingPayments} ta*\n` +
      `Tasdiqlangan to'lovlar: *${completedPayments} ta*\n\n` +
      `*Oxirgi 5 ta foydalanuvchi:*\n`;
    
    const recentUsers = await User.find().sort({ createdAt: -1 }).limit(5);
    
    let usersList = '';
    for (const user of recentUsers) {
      usersList += `• @${user.username || 'Noma\'lum'} (${user.telegramId}) - ${user.balanceUC} UC\n`;
    }
    
    await ctx.replyWithMarkdown(statsText + usersList);
  } catch (error) {
    console.error('Statistika olishda xatolik:', error);
    await ctx.reply('❌ Statistika olishda xatolik yuz berdi.');
  }
});

bot.hears('💰 To\'lovlar', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  
  const pendingPayments = await Payment.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(10);
  
  if (pendingPayments.length === 0) {
    await ctx.reply('✅ Kutilayotgan to\'lovlar yo\'q.');
    return;
  }
  
  let paymentsText = `💰 *Kutilayotgan to'lovlar (${pendingPayments.length} ta)*\n\n`;
  
  for (const payment of pendingPayments) {
    paymentsText += `🔹 *ID:* ${payment._id}\n` +
      `👤 Foydalanuvchi: @${payment.username || 'Noma\'lum'}\n` +
      `🆔 User ID: ${payment.userId}\n` +
      `💎 UC: ${payment.amountUC}\n` +
      `💰 So'm: ${formatNumber(payment.amountSoom)}\n` +
      `📅 Sana: ${new Date(payment.createdAt).toLocaleDateString('uz-UZ')}\n\n`;
  }
  
  paymentsText += `\nTasdiqlash uchun to'lov ID sini /approve_{id} yoki /reject_{id} buyrug'i bilan boshqaring.`;
  
  await ctx.replyWithMarkdown(paymentsText);
});

bot.hears('👥 Foydalanuvchilar', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  
  const users = await User.find().sort({ createdAt: -1 }).limit(10);
  
  let usersText = `👥 *Oxirgi 10 ta foydalanuvchi*\n\n`;
  
  for (const user of users) {
    const regDate = new Date(user.createdAt).toLocaleDateString('uz-UZ');
    usersText += `• @${user.username || 'Noma\'lum'} (ID: ${user.telegramId})\n` +
      `  Balans: ${user.balanceUC} UC | Takliflar: ${user.referralsCount}\n` +
      `  Ro'yxatdan: ${regDate}\n\n`;
  }
  
  await ctx.replyWithMarkdown(usersText);
});

bot.hears('🏆 Konkurs boshqaruvi', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  
  const contests = await Contest.find().sort({ createdAt: -1 }).limit(5);
  
  let contestsText = `🏆 *Konkurslar boshqaruvi*\n\n`;
  
  if (contests.length === 0) {
    contestsText += `Hozircha konkurslar yo'q.\n`;
  } else {
    for (const contest of contests) {
      const status = contest.isActive ? '✅ Faol' : '❌ Nofaol';
      const endsAt = contest.endsAt ? new Date(contest.endsAt).toLocaleDateString('uz-UZ') : 'Muddatsiz';
      contestsText += `*${contest.title}*\n` +
        `Holati: ${status}\n` +
        `Mukofot: ${contest.prize}\n` +
        `Tugash: ${endsAt}\n` +
        `Ishtirokchilar: ${contest.participants?.length || 0} ta\n\n`;
    }
  }
  
  contestsText += `\n*Buyruqlar:*\n` +
    `/createcontest - Yangi konkurs yaratish\n` +
    `/togglecontest_{id} - Konkurs holatini o'zgartirish`;
  
  await ctx.replyWithMarkdown(contestsText);
});

bot.hears('📢 Xabar yuborish', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  
  await ctx.reply(
    '📢 Xabar yuborish uchun quyidagi formatda yuboring:\n\n' +
    '/broadcast Salom! Yangilik bor!\n\n' +
    'Yoki rasm bilan xabar yuborish uchun:\n' +
    '/broadcastphoto Rasm sarlavhasi\n' +
    'keyin rasm yuboring.'
  );
});

bot.hears('🔙 Asosiy menyu', async (ctx) => {
  await ctx.reply('Asosiy menyuga qaytildi:', mainMenuKeyboard);
});

// ========================
// ADMIN COMMAND HANDLERS
// ========================

// Approve payment by ID
bot.action(/approve_(\w+)/, async (ctx) => {
  const adminId = ctx.from.id;
  const paymentId = ctx.match[1];
  
  if (!ADMIN_IDS.includes(adminId)) {
    await ctx.answerCbQuery('Ruxsat yo\'q');
    return;
  }
  
  try {
    const payment = await Payment.findById(paymentId);
    
    if (!payment) {
      await ctx.answerCbQuery('To\'lov topilmadi');
      return;
    }
    
    if (payment.status !== 'pending') {
      await ctx.answerCbQuery('To\'lov allaqachon ko\'rib chiqilgan');
      return;
    }
    
    // Update payment status
    payment.status = 'approved';
    payment.updatedAt = new Date();
    await payment.save();
    
    // Add UC to user balance
    await updateUserBalance(payment.userId, payment.amountUC);
    
    // Update user
    const user = await User.findOne({ telegramId: payment.userId });
    
    // Edit original message
    await ctx.editMessageCaption(
      `✅ *TO'LOV TASDIQLANDI*\n\n` +
      `Foydalanuvchi: @${payment.username || 'Noma\'lum'}\n` +
      `ID: ${payment.userId}\n` +
      `Miqdor: ${payment.amountUC} UC\n` +
      `Summa: ${formatNumber(payment.amountSoom)} so'm\n` +
      `Admin: @${ctx.from.username || 'admin'}\n` +
      `Vaqt: ${new Date().toLocaleString('uz-UZ')}`,
      { parse_mode: 'Markdown' }
    );
    
    // Notify user
    try {
      await ctx.telegram.sendMessage(
        payment.userId,
        `✅ *To'lovingiz tasdiqlandi!*\n\n` +
        `Miqdor: ${payment.amountUC} UC\n` +
        `Summa: ${formatNumber(payment.amountSoom)} so'm\n` +
        `Yangi balans: ${user.balanceUC} UC\n\n` +
        `Mablag' hisobingizga muvaffaqiyatli qo'shildi.`
      );
    } catch (err) {
      console.error('Foydalanuvchiga xabar yuborishda xatolik:', err);
    }
    
    await ctx.answerCbQuery('✅ To\'lov tasdiqlandi');
    
  } catch (error) {
    console.error('To\'lovni tasdiqlashda xatolik:', error);
    await ctx.answerCbQuery('Xatolik yuz berdi');
  }
});

// Reject payment by ID
bot.action(/reject_(\w+)/, async (ctx) => {
  const adminId = ctx.from.id;
  const paymentId = ctx.match[1];
  
  if (!ADMIN_IDS.includes(adminId)) {
    await ctx.answerCbQuery('Ruxsat yo\'q');
    return;
  }
  
  try {
    const payment = await Payment.findById(paymentId);
    
    if (!payment) {
      await ctx.answerCbQuery('To\'lov topilmadi');
      return;
    }
    
    if (payment.status !== 'pending') {
      await ctx.answerCbQuery('To\'lov allaqachon ko\'rib chiqilgan');
      return;
    }
    
    // Update payment status
    payment.status = 'rejected';
    payment.updatedAt = new Date();
    await payment.save();
    
    // Edit original message
    await ctx.editMessageCaption(
      `❌ *TO'LOV RAD ETILDI*\n\n` +
      `Foydalanuvchi: @${payment.username || 'Noma\'lum'}\n` +
      `ID: ${payment.userId}\n` +
      `Miqdor: ${payment.amountUC} UC\n` +
      `Summa: ${formatNumber(payment.amountSoom)} so'm\n` +
      `Admin: @${ctx.from.username || 'admin'}\n` +
      `Vaqt: ${new Date().toLocaleString('uz-UZ')}`,
      { parse_mode: 'Markdown' }
    );
    
    // Notify user
    try {
      await ctx.telegram.sendMessage(
        payment.userId,
        `❌ *To'lovingiz rad etildi*\n\n` +
        `Miqdor: ${payment.amountUC} UC\n` +
        `Summa: ${formatNumber(payment.amountSoom)} so'm\n\n` +
        `Iltimos, admin bilan bog'laning: ${ADMIN_PHONE}`
      );
    } catch (err) {
      console.error('Foydalanuvchiga xabar yuborishda xatolik:', err);
    }
    
    await ctx.answerCbQuery('❌ To\'lov rad etildi');
    
  } catch (error) {
    console.error('To\'lovni rad etishda xatolik:', error);
    await ctx.answerCbQuery('Xatolik yuz berdi');
  }
});

// ========================
// BROADCAST COMMANDS
// ========================

bot.command('broadcast', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  
  const text = ctx.message.text.replace('/broadcast', '').trim();
  
  if (!text) {
    await ctx.reply('Iltimos, xabar matnini kiriting.');
    return;
  }
  
  const users = await User.find({});
  let sent = 0;
  let failed = 0;
  
  const progressMsg = await ctx.reply(`📢 Xabar ${users.length} ta foydalanuvchiga yuborilmoqda...`);
  
  for (const user of users) {
    try {
      await ctx.telegram.sendMessage(user.telegramId, text);
      sent++;
      // Delay to avoid rate limiting
      if (sent % 20 === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (err) {
      failed++;
      console.error(`Xabar yuborishda xatolik (${user.telegramId}):`, err.message);
    }
  }
  
  await ctx.telegram.editMessageText(
    ctx.chat.id,
    progressMsg.message_id,
    null,
    `✅ Xabar yuborish yakunlandi:\n` +
    `Yuborildi: ${sent} ta\n` +
    `Yuborilmadi: ${failed} ta\n` +
    `Jami: ${users.length} ta`
  );
});

// ========================
// CONTEST COMMANDS
// ========================

// Create contest command
bot.command('createcontest', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  
  const args = ctx.message.text.split('\n');
  if (args.length < 3) {
    await ctx.reply(
      'Konkurs yaratish formati:\n\n' +
      '/createcontest\n' +
      'Konkurs nomi\n' +
      'Tavsif\n' +
      'Mukofot\n' +
      'Muddati (ixtiyoriy) DD.MM.YYYY\n\n' +
      'Misol:\n' +
      '/createcontest\n' +
      'PUBG Turniri\n' +
      'Eng ko\'p o\'ldirganlar uchun\n' +
      '1000 UC\n' +
      '31.12.2024'
    );
    return;
  }
  
  try {
    const title = args[1].trim();
    const description = args[2].trim();
    const prize = args[3].trim();
    let endsAt = null;
    
    if (args[4]) {
      const dateParts = args[4].trim().split('.');
      if (dateParts.length === 3) {
        endsAt = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`);
      }
    }
    
    const contest = new Contest({
      title,
      description,
      prize,
      endsAt,
      isActive: true
    });
    
    await contest.save();
    
    await ctx.reply(
      `✅ Konkurs muvaffaqiyatli yaratildi!\n\n` +
      `Nomi: ${title}\n` +
      `Tavsif: ${description}\n` +
      `Mukofot: ${prize}\n` +
      `ID: ${contest._id}`
    );
    
  } catch (error) {
    console.error('Konkurs yaratishda xatolik:', error);
    await ctx.reply('❌ Konkurs yaratishda xatolik yuz berdi.');
  }
});

// Toggle contest status
bot.command(/togglecontest_(.+)/, async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  
  const contestId = ctx.match[1];
  
  try {
    const contest = await Contest.findById(contestId);
    
    if (!contest) {
      await ctx.reply('❌ Konkurs topilmadi.');
      return;
    }
    
    contest.isActive = !contest.isActive;
    await contest.save();
    
    const status = contest.isActive ? 'faollashtirildi' : 'nofaollashtirildi';
    
    await ctx.reply(
      `✅ Konkurs ${status}!\n\n` +
      `Nomi: ${contest.title}\n` +
      `Holati: ${contest.isActive ? '✅ Faol' : '❌ Nofaol'}\n` +
      `Mukofot: ${contest.prize}`
    );
    
  } catch (error) {
    console.error('Konkurs holatini o\'zgartirishda xatolik:', error);
    await ctx.reply('❌ Xatolik yuz berdi.');
  }
});

// ========================
// ERROR HANDLING
// ========================

bot.catch((err, ctx) => {
  console.error(`Bot xatosi:`, err);
  if (ctx.chat) {
    ctx.reply('❌ Botda xatolik yuz berdi. Iltimos, keyinroq urinib ko\'ring.');
  }
});

// ========================
// BOT LAUNCH
// ========================

async function launchBot() {
  try {
    // Start bot
    await bot.launch();
    console.log('🤖 PUBG UC Bot ishga tushdi!');
    
    // Bot info
    const botInfo = await bot.telegram.getMe();
    console.log(`🤖 Bot: @${botInfo.username}`);
    
    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
    
  } catch (error) {
    console.error('Botni ishga tushirishda xatolik:', error);
    process.exit(1);
  }
}

// Start the bot
launchBot();