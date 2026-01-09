const { Telegraf, Markup, session } = require('telegraf');
const mongoose = require('mongoose');

// SOZLAMALAR
const BOT_TOKEN = '8437722542:AAHmkvXWpHfsom4uxqMtwVyr2bM6HaQa2j0';
const MONGODB_URL = 'mongodb+srv://abumafia0:abumafia0@abumafia.h1trttg.mongodb.net/multfilmuzbot?appName=abumafia';

// Bir nechta admin
const ADMIN_IDS = [6606638731, 901126203]; // Raqamlar bilan!

// Render.com muhit o'zgaruvchilari
const PORT = process.env.PORT || 3000;
const URL = process.env.RENDER_EXTERNAL_URL || process.env.URL; // Render avto beradi
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'super_secret_token_123'; // Ixtiyoriy himoya

mongoose.connect(MONGODB_URL)
    .then(() => console.log('MongoDB ulandi'))
    .catch(err => console.error('MongoDB xatosi:', err));

// Schemalar
const userSchema = new mongoose.Schema({
    user_id: { type: Number, required: true, unique: true },
    username: String,
    first_name: String,
    join_date: { type: Date, default: Date.now }
});

const movieSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    file_id: { type: String, required: true },
    caption: String,
    date: { type: Date, default: Date.now },
    added_by: Number // Admin ID
});

const subscriptionSchema = new mongoose.Schema({
    chat_username: { type: String, required: true, unique: true },
    type: { type: String, enum: ['channel', 'group'], required: true }
});

const User = mongoose.model('User', userSchema);
const Movie = mongoose.model('Movie', movieSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);

// Bot yaratish
const bot = new Telegraf(BOT_TOKEN);
bot.use(session({
    defaultSession: () => ({
        addingMovie: false,
        broadcasting: false,
        movieData: null,
        waitingForCode: false
    })
}));

// Admin tekshirish
function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

// Obuna tekshirish
async function checkAllSubscriptions(userId) {
    if (isAdmin(userId)) return true;

    try {
        const subs = await Subscription.find({});
        if (subs.length === 0) return true;

        for (const sub of subs) {
            try {
                const chatId = sub.chat_username.startsWith('@') 
                    ? sub.chat_username 
                    : `@${sub.chat_username}`;
                
                const member = await bot.telegram.getChatMember(chatId, userId);
                const status = member.status;
                if (status === 'left' || status === 'kicked') {
                    return false;
                }
            } catch (error) {
                console.error(`Obuna xatosi (${sub.chat_username}):`, error.message);
                return false;
            }
        }
        return true;
    } catch (error) {
        console.error('Obunalar xatosi:', error);
        return false;
    }
}

// Obuna klaviaturasi
async function getSubscriptionKeyboard() {
    const subs = await Subscription.find({});
    const rows = subs.map(sub =>
        [Markup.button.url(
            sub.type === 'channel' ? `📢 ${sub.chat_username}` : `👥 ${sub.chat_username}`,
            `https://t.me/${sub.chat_username.replace('@', '')}`
        )]
    );
    rows.push([Markup.button.callback('✅ Tekshirish', 'check_subscription')]);
    return Markup.inlineKeyboard(rows);
}

// User qo'shish
async function addUser(ctx) {
    try {
        const existing = await User.findOne({ user_id: ctx.from.id });
        if (!existing) {
            await User.create({
                user_id: ctx.from.id,
                username: ctx.from.username || null,
                first_name: ctx.from.first_name || null
            });
        }
    } catch (error) {
        console.error('User qo\'shish xatosi:', error);
    }
}

// START HANDLER
bot.start(async (ctx) => {
    await addUser(ctx);
    const userId = ctx.from.id;
    const isSubscribed = await checkAllSubscriptions(userId);

    if (!isSubscribed && !isAdmin(userId)) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply('🤖 Multfilm Botiga xush kelibsiz!\n\nBotdan foydalanish uchun quyidagi kanal va guruhlarga obuna boʻling:', keyboard);
    }

    if (isAdmin(userId)) {
        const adminKeyboard = Markup.keyboard([
            ['🎬 Multfilm qoʻshish', '📊 Statistika'],
            ['📢 Broadcast'],
            ['➕ Kanal qoʻshish', '➕ Guruh qoʻshish'],
            ['📋 Roʻyxatni koʻrish', '➖ Oʻchirish'],
            ['🏠 Bosh menyu']
        ]).resize().oneTime();
        return ctx.reply('👨‍💻 Admin panelga xush kelibsiz!', adminKeyboard);
    }

    ctx.reply('🎬 Multfilm Botiga xush kelibsiz!\n\nMultfilm olish uchun kod yuboring (masalan: 7)\n\nBotni qayta ishga tushurish: /start');
});

bot.hears('🏠 Bosh menyu', async (ctx) => {
    await addUser(ctx);
    const userId = ctx.from.id;
    const isSubscribed = await checkAllSubscriptions(userId);

    if (!isSubscribed && !isAdmin(userId)) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply('Botdan foydalanish uchun quyidagi kanal va guruhlarga obuna boʻling:', keyboard);
    }

    if (isAdmin(userId)) {
        const adminKeyboard = Markup.keyboard([
            ['🎬 Multfilm qoʻshish', '📊 Statistika'],
            ['📢 Broadcast'],
            ['➕ Kanal qoʻshish', '➕ Guruh qoʻshish'],
            ['📋 Roʻyxatni koʻrish', '➖ Oʻchirish'],
            ['🏠 Bosh menyu']
        ]).resize().oneTime();
        return ctx.reply('Admin panel:', adminKeyboard);
    }

    ctx.reply('🎬 Multfilm olish uchun kod yuboring (masalan: 7)');
});

bot.action('check_subscription', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const isSubscribed = await checkAllSubscriptions(userId);

    if (isSubscribed || isAdmin(userId)) {
        await addUser(ctx);
        if (isAdmin(userId)) {
            const adminKeyboard = Markup.keyboard([
                ['🎬 Multfilm qoʻshish', '📊 Statistika'],
                ['📢 Broadcast'],
                ['➕ Kanal qoʻshish', '➕ Guruh qoʻshish'],
                ['📋 Roʻyxatni koʻrish', '➖ Oʻchirish'],
                ['🏠 Bosh menyu']
            ]).resize().oneTime();
            return ctx.editMessageText('✅ Obuna tasdiqlandi! Admin panelga xush kelibsiz!');
        }
        await ctx.deleteMessage();
        return ctx.reply('✅ Obuna tasdiqlandi! Endi multfilm olish uchun kod yuboring.');
    }

    const keyboard = await getSubscriptionKeyboard();
    ctx.editMessageText('Hali barcha kanal va guruhlarga obuna boʻlmagansiz:', keyboard);
});

// ADMIN COMMANDS
bot.hears('🎬 Multfilm qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('Bu buyruq faqat adminlar uchun!');
    
    ctx.session.addingMovie = true;
    ctx.session.waitingForCode = false;
    ctx.session.movieData = null;
    
    ctx.reply('🎬 Multfilm qoʻshish rejimi yoqildi!\n\nEndi video yuboring (forward qilishingiz shart emas).\n\n⚠️ Eslatma: Video + izoh bilan yuborishingiz mumkin.');
});

bot.hears('📊 Statistika', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    try {
        const users = await User.countDocuments();
        const movies = await Movie.countDocuments();
        const subs = await Subscription.countDocuments();
        const lastMovies = await Movie.find().sort({date: -1}).limit(5);
        
        let movieList = '';
        lastMovies.forEach((movie, i) => {
            movieList += `${i+1}. Kodi: ${movie.code} - ${new Date(movie.date).toLocaleDateString()}\n`;
        });
        
        ctx.reply(`📊 BOT STATISTIKASI:\n\n👥 Foydalanuvchilar: ${users}\n🎬 Multfilmlar: ${movies}\n📢 Majburiy obunalar: ${subs}\n\n📥 So'ngi 5 multfilm:\n${movieList}`);
    } catch (err) {
        console.error(err);
        ctx.reply('Statistika olishda xatolik');
    }
});

bot.hears('📢 Broadcast', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    ctx.session.broadcasting = true;
    ctx.session.addingMovie = false;
    ctx.session.waitingForCode = false;
    
    ctx.reply('📢 Broadcast rejimi yoqildi!\n\nEndi barcha foydalanuvchilarga yubormoqchi boʻlgan matn, rasm, video yoki boshqa kontentni yuboring.\n\n❌ Bekor qilish: /cancel');
});

bot.hears('➕ Kanal qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    ctx.session.awaitingChannel = true;
    ctx.session.awaitingGroup = false;
    ctx.session.addingMovie = false;
    
    ctx.reply('➕ Yangi kanal qoʻshish:\n\nKanal username ni yuboring (masalan: @hallaym yoki hallaym):');
});

bot.hears('➕ Guruh qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    ctx.session.awaitingGroup = true;
    ctx.session.awaitingChannel = false;
    ctx.session.addingMovie = false;
    
    ctx.reply('➕ Yangi guruh qoʻshish:\n\nGuruh username ni yuboring (masalan: @talabagacha yoki talabagacha):');
});

bot.hears('📋 Roʻyxatni koʻrish', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    const subs = await Subscription.find({});
    if (subs.length === 0) return ctx.reply('📭 Hozircha majburiy obuna yoʻq.');
    
    const list = subs.map((s, i) => 
        `${i+1}. ${s.type === 'channel' ? '📢' : '👥'} ${s.chat_username}`
    ).join('\n');
    
    ctx.reply(`📋 Majburiy obunalar roʻyxati:\n\n${list}\n\nJami: ${subs.length} ta`);
});

bot.hears('➖ Oʻchirish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    ctx.session.deletingSub = true;
    ctx.session.addingMovie = false;
    
    ctx.reply('➖ Obunani oʻchirish:\n\nOʻchirish uchun kanal yoki guruh username ni yuboring (masalan: @hallaym):\n\n❌ Bekor qilish: /cancel');
});

// VIDEO HANDLER - MULTFILM QO'SHISH
bot.on('video', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    if (ctx.session.addingMovie) {
        // Videoni qabul qilish
        const video = ctx.message.video;
        const caption = ctx.message.caption || '';
        
        ctx.session.movieData = {
            file_id: video.file_id,
            caption: caption,
            message_id: ctx.message.message_id
        };
        
        ctx.session.waitingForCode = true;
        ctx.session.addingMovie = false;
        
        // Video haqida ma'lumot
        const videoInfo = `📹 Video qabul qilindi!\n\n` +
                         `📏 Hajmi: ${(video.file_size / (1024*1024)).toFixed(2)} MB\n` +
                         `🕐 Davomiyligi: ${video.duration} soniya\n` +
                         `📝 Izoh: ${caption || 'Yoʻq'}\n\n` +
                         `Endi ushbu video uchun kod yuboring (masalan: 7):\n\n` +
                         `❌ Bekor qilish: /cancel`;
        
        ctx.reply(videoInfo);
    }
});

// TEXT HANDLER
bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;
    
    // Cancel command
    if (text === '/cancel') {
        ctx.session.addingMovie = false;
        ctx.session.broadcasting = false;
        ctx.session.waitingForCode = false;
        ctx.session.awaitingChannel = false;
        ctx.session.awaitingGroup = false;
        ctx.session.deletingSub = false;
        ctx.session.movieData = null;
        
        return ctx.reply('❌ Jarayon bekor qilindi.');
    }
    
    // Admin commands
    if (isAdmin(userId)) {
        // Kanal qo'shish
        if (ctx.session.awaitingChannel) {
            let username = text.startsWith('@') ? text : `@${text}`;
            
            try {
                await Subscription.create({ 
                    chat_username: username, 
                    type: 'channel' 
                });
                ctx.session.awaitingChannel = false;
                return ctx.reply(`✅ ${username} kanali muvaffaqiyatli qoʻshildi!`);
            } catch (err) {
                if (err.code === 11000) {
                    return ctx.reply(`❌ ${username} kanali allaqachon mavjud.`);
                }
                return ctx.reply('❌ Xatolik yuz berdi. Qayta urinib koʻring.');
            }
        }
        
        // Guruh qo'shish
        if (ctx.session.awaitingGroup) {
            let username = text.startsWith('@') ? text : `@${text}`;
            
            try {
                await Subscription.create({ 
                    chat_username: username, 
                    type: 'group' 
                });
                ctx.session.awaitingGroup = false;
                return ctx.reply(`✅ ${username} guruhi muvaffaqiyatli qoʻshildi!`);
            } catch (err) {
                if (err.code === 11000) {
                    return ctx.reply(`❌ ${username} guruhi allaqachon mavjud.`);
                }
                return ctx.reply('❌ Xatolik yuz berdi. Qayta urinib koʻring.');
            }
        }
        
        // Obunani o'chirish
        if (ctx.session.deletingSub) {
            const username = text;
            const result = await Subscription.deleteOne({ chat_username: username });
            
            ctx.session.deletingSub = false;
            
            if (result.deletedCount > 0) {
                return ctx.reply(`✅ ${username} obunasi muvaffaqiyatli oʻchirildi.`);
            } else {
                return ctx.reply('❌ Bunday obuna topilmadi.');
            }
        }
        
        // Kod qabul qilish (multfilm qo'shish)
        if (ctx.session.waitingForCode && ctx.session.movieData) {
            const code = text.trim();
            
            // Kodni tekshirish
            if (!/^[a-zA-Z0-9]+$/.test(code)) {
                return ctx.reply('❌ Kod faqat harf va raqamlardan iborat boʻlishi kerak. Qayta kiriting:');
            }
            
            try {
                // Kod bormi tekshirish
                const existing = await Movie.findOne({ code: code });
                if (existing) {
                    return ctx.reply(`❌ "${code}" kodi allaqachon ishlatilgan. Boshqa kod kiriting:\n\n❌ Bekor qilish: /cancel`);
                }
                
                // Multfilmni saqlash
                await Movie.create({
                    code: code,
                    file_id: ctx.session.movieData.file_id,
                    caption: ctx.session.movieData.caption,
                    added_by: userId
                });
                
                // Sessionni tozalash
                ctx.session.waitingForCode = false;
                ctx.session.movieData = null;
                
                return ctx.reply(`✅ "${code}" kodli multfilm muvaffaqiyatli saqlandi!\n\nEndi foydalanuvchilar bu kod orqali multfilmni olishlari mumkin.`);
            } catch (err) {
                console.error('Saqlash xatosi:', err);
                return ctx.reply('❌ Saqlashda xatolik yuz berdi. Qayta urinib koʻring.');
            }
        }
        
        // Broadcast
        if (ctx.session.broadcasting) {
            try {
                const users = await User.find({});
                let success = 0;
                let failed = 0;
                
                for (const user of users) {
                    try {
                        await ctx.telegram.copyMessage(
                            user.user_id, 
                            ctx.chat.id, 
                            ctx.message.message_id
                        );
                        success++;
                        
                        // Spamdan saqlanish uchun kichik kutish
                        await new Promise(resolve => setTimeout(resolve, 50));
                    } catch (e) {
                        failed++;
                        console.error(`User ${user.user_id}: ${e.message}`);
                    }
                }
                
                ctx.session.broadcasting = false;
                
                return ctx.reply(`✅ Broadcast yakunlandi!\n\n✅ Muvaffaqiyatli: ${success} ta\n❌ Xatolik: ${failed} ta`);
            } catch (err) {
                ctx.session.broadcasting = false;
                console.error('Broadcast xatosi:', err);
                return ctx.reply('❌ Broadcastda xatolik yuz berdi.');
            }
        }
    }
    
    // Foydalanuvchi uchun kod yuborish
    const isSubscribed = await checkAllSubscriptions(userId);
    if (!isSubscribed && !isAdmin(userId)) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply('Botdan foydalanish uchun avval barcha kanal va guruhlarga obuna boʻling:', keyboard);
    }
    
    // Multfilm qidirish
    const code = text;
    try {
        const movie = await Movie.findOne({ code: code });
        if (!movie) {
            return ctx.reply('❌ Bunday kodda multfilm topilmadi.\n\nKodni tekshirib, qayta urinib koʻring.');
        }
        
        // Foydalanuvchini qo'shish
        await addUser(ctx);
        
        // Multfilmni yuborish
        await ctx.replyWithVideo(movie.file_id, {
            caption: movie.caption ? 
                    `${movie.caption}\n\nKod: ${movie.code}` : 
                    `🎬 Multfilm kodi: ${movie.code}\n\nYana multfilm olish uchun yangi kod yuboring!`
        });
        
    } catch (err) {
        console.error('Multfilm yuborish xatosi:', err);
        ctx.reply('❌ Multfilm yuborishda xatolik yuz berdi. Iltimos, qayta urinib koʻring.');
    }
});

// BROADCAST HANDLER - boshqa turlar uchun
bot.on(['photo', 'document', 'audio', 'voice', 'animation', 'sticker'], async (ctx) => {
    if (!isAdmin(ctx.from.id) || !ctx.session.broadcasting) return;
    
    try {
        const users = await User.find({});
        let success = 0;
        let failed = 0;
        
        for (const user of users) {
            try {
                await ctx.telegram.copyMessage(
                    user.user_id, 
                    ctx.chat.id, 
                    ctx.message.message_id
                );
                success++;
                
                // Spamdan saqlanish uchun kichik kutish
                await new Promise(resolve => setTimeout(resolve, 50));
            } catch (e) {
                failed++;
            }
        }
        
        ctx.session.broadcasting = false;
        
        ctx.reply(`✅ Broadcast yakunlandi!\n\n✅ Muvaffaqiyatli: ${success} ta\n❌ Xatolog: ${failed} ta`);
    } catch (err) {
        ctx.session.broadcasting = false;
        ctx.reply('❌ Broadcastda xatolik yuz berdi.');
    }
});

// WEBHOOK SOZLASH
if (URL) {
    const express = require('express');
    const app = express();
    
    // Webhook yo'li
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    const fullUrl = `${URL}${webhookPath}`;
    
    // Webhook o'rnatish
    bot.telegram.setWebhook(fullUrl, {
        secret_token: WEBHOOK_SECRET
    }).then(() => {
        console.log(`✅ Webhook o'rnatildi: ${fullUrl}`);
    }).catch(err => {
        console.error('❌ Webhook o\'rnatishda xato:', err.message);
    });
    
    // Middleware
    app.use(express.json());
    
    // Webhook endpoint
    app.post(webhookPath, (req, res) => {
        // Secret token tekshirish
        if (req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
            return res.status(403).send('Forbidden');
        }
        return bot.webhookCallback(webhookPath)(req, res);
    });
    
    // Health check
    app.get('/', (req, res) => {
        res.send('🎬 Multfilm Bot ishlamoqda!');
    });
    
    // Bot holati
    app.get('/status', async (req, res) => {
        try {
            const users = await User.countDocuments();
            const movies = await Movie.countDocuments();
            res.json({
                status: 'online',
                users: users,
                movies: movies,
                uptime: process.uptime()
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    
    // Server ishga tushirish
    app.listen(PORT, () => {
        console.log(`🚀 Server ${PORT} portda ishga tushdi`);
        console.log(`🌐 Webhook URL: ${fullUrl}`);
    });
} else {
    // Local ishlash uchun polling
    bot.launch()
        .then(() => console.log('🤖 Bot polling rejimida ishga tushdi (local)'))
        .catch(err => console.error('❌ Xatolik:', err));
}

// Processni to'xtatish
process.once('SIGINT', () => {
    console.log('Bot toʻxtatilmoqda...');
    bot.stop('SIGINT');
    process.exit(0);
});

process.once('SIGTERM', () => {
    console.log('Bot toʻxtatilmoqda...');
    bot.stop('SIGTERM');
    process.exit(0);
});

console.log('🎬 Multfilm Bot ishga tushirilmoqda...');
