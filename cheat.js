const { Telegraf, Markup, session } = require('telegraf');
const mongoose = require('mongoose');

// SOZLAMALAR
const BOT_TOKEN = '7722628992:AAG0Wb43nZ3OJgSMRyJVj5TTBKzrzqkJ0wQ';
const MONGODB_URL = 'mongodb+srv://abumafia0:abumafia0@abumafia.h1trttg.mongodb.net/cheatgame?appName=abumafia';

// Bir nechta admin
const ADMIN_IDS = [6606638731, 901126203];

// Render.com muhit o'zgaruvchilari
const PORT = process.env.PORT || 3000;
const URL = process.env.RENDER_EXTERNAL_URL || process.env.URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'super_secret_token_123';

mongoose.connect(MONGODB_URL)
    .then(() => console.log('MongoDB ulandi'))
    .catch(err => console.error('MongoDB xatosi:', err));

// Schemalar
const userSchema = new mongoose.Schema({
    user_id: { type: Number, required: true, unique: true },
    username: String,
    first_name: String,
    join_date: { type: Date, default: Date.now },
    last_activity: { type: Date, default: Date.now }
});

const contentSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    file_id: { type: String, required: true },
    file_type: { type: String, enum: ['video', 'document', 'photo', 'audio'], required: true },
    caption: String,
    category: { type: String, enum: ['PUBG', 'Free Fire', 'Call of Duty', 'Minecraft', 'Other'], default: 'Other' },
    tags: [String],
    date: { type: Date, default: Date.now },
    added_by: Number,
    downloads: { type: Number, default: 0 }
});

const subscriptionSchema = new mongoose.Schema({
    chat_username: { type: String, required: true, unique: true },
    type: { type: String, enum: ['channel', 'group'], required: true },
    name: String
});

const User = mongoose.model('User', userSchema);
const Content = mongoose.model('Content', contentSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);

// Bot yaratish
const bot = new Telegraf(BOT_TOKEN);
bot.use(session({
    defaultSession: () => ({
        addingContent: false,
        broadcasting: false,
        contentData: null,
        waitingForCode: false,
        waitingForCategory: false,
        addingTags: false,
        searchMode: false,
        userSearch: false,
        awaitingChannel: false,
        awaitingGroup: false,
        deletingSub: false
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
            sub.type === 'channel' ? `📢 ${sub.name || sub.chat_username}` : `👥 ${sub.name || sub.chat_username}`,
            `https://t.me/${sub.chat_username.replace('@', '')}`
        )]
    );
    rows.push([Markup.button.callback('✅ Tekshirish', 'check_subscription')]);
    return Markup.inlineKeyboard(rows);
}

// Kategoriya klaviaturasi
function getCategoryKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('🎮 PUBG', 'category_PUBG'),
            Markup.button.callback('🔥 Free Fire', 'category_Free Fire')
        ],
        [
            Markup.button.callback('🔫 Call of Duty', 'category_Call of Duty'),
            Markup.button.callback('⛏️ Minecraft', 'category_Minecraft')
        ],
        [
            Markup.button.callback('📁 Other', 'category_Other'),
            Markup.button.callback('❌ Bekor qilish', 'cancel_operation')
        ]
    ]);
}

// User qo'shish yoki yangilash
async function addUser(ctx) {
    try {
        await User.findOneAndUpdate(
            { user_id: ctx.from.id },
            {
                username: ctx.from.username || null,
                first_name: ctx.from.first_name || null,
                last_activity: new Date()
            },
            { upsert: true, new: true }
        );
    } catch (error) {
        console.error('User qo\'shish xatosi:', error);
    }
}

// Sessionni tozalash
function resetSession(ctx) {
    ctx.session.addingContent = false;
    ctx.session.broadcasting = false;
    ctx.session.contentData = null;
    ctx.session.waitingForCode = false;
    ctx.session.waitingForCategory = false;
    ctx.session.addingTags = false;
    ctx.session.searchMode = false;
    ctx.session.userSearch = false;
    ctx.session.awaitingChannel = false;
    ctx.session.awaitingGroup = false;
    ctx.session.deletingSub = false;
}

// START HANDLER
bot.start(async (ctx) => {
    await addUser(ctx);
    const userId = ctx.from.id;
    const isSubscribed = await checkAllSubscriptions(userId);

    if (!isSubscribed && !isAdmin(userId)) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply('🎮 Game Cheat Media Botiga xush kelibsiz!\n\nBotdan foydalanish uchun quyidagi kanal va guruhlarga obuna boʻling:', keyboard);
    }

    if (isAdmin(userId)) {
        const adminKeyboard = Markup.keyboard([
            ['➕ Cheat qoʻshish', '📊 Statistika'],
            ['📢 Broadcast', '🔍 Kontent qidirish'],
            ['➕ Kanal qoʻshish', '➕ Guruh qoʻshish'],
            ['📋 Obunalar roʻyxati', '➖ Obunani oʻchirish'],
            ['🏠 Bosh menyu', '🎮 Kategoriyalar']
        ]).resize().oneTime();
        return ctx.reply('👨‍💻 Admin panelga xush kelibsiz!\n\nCheat kodlar, modlar va konfiguratsiya fayllarini boshqarishingiz mumkin.', adminKeyboard);
    }

    const userKeyboard = Markup.keyboard([
        ['🎮 PUBG Cheatlar', '🔥 Free Fire'],
        ['🔫 Call of Duty', '⛏️ Minecraft'],
        ['🔍 Qidirish', '📁 Barcha kontent'],
        ['🏠 Bosh menyu']
    ]).resize().oneTime();
    
    ctx.reply('🎮 Game Cheat Media Botiga xush kelibsiz!\n\nOʻyinlar uchun cheat kodlari, modlar, konfiguratsiya fayllari va boshqa kontentlarni toping!\n\nKategoriya tanlang yoki kod yuboring:', userKeyboard);
});

// BOSH MENYU
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
            ['➕ Cheat qoʻshish', '📊 Statistika'],
            ['📢 Broadcast', '🔍 Kontent qidirish'],
            ['➕ Kanal qoʻshish', '➕ Guruh qoʻshish'],
            ['📋 Obunalar roʻyxati', '➖ Obunani oʻchirish'],
            ['🏠 Bosh menyu', '🎮 Kategoriyalar']
        ]).resize().oneTime();
        return ctx.reply('Admin panel:', adminKeyboard);
    }

    const userKeyboard = Markup.keyboard([
        ['🎮 PUBG Cheatlar', '🔥 Free Fire'],
        ['🔫 Call of Duty', '⛏️ Minecraft'],
        ['🔍 Qidirish', '📁 Barcha kontent'],
        ['🏠 Bosh menyu']
    ]).resize().oneTime();
    
    ctx.reply('Bosh menyu:', userKeyboard);
});

// OBUNA TEKSHIRISH
bot.action('check_subscription', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const isSubscribed = await checkAllSubscriptions(userId);

    if (isSubscribed || isAdmin(userId)) {
        await addUser(ctx);
        if (isAdmin(userId)) {
            const adminKeyboard = Markup.keyboard([
                ['➕ Cheat qoʻshish', '📊 Statistika'],
                ['📢 Broadcast', '🔍 Kontent qidirish'],
                ['➕ Kanal qoʻshish', '➕ Guruh qoʻshish'],
                ['📋 Obunalar roʻyxati', '➖ Obunani oʻchirish'],
                ['🏠 Bosh menyu', '🎮 Kategoriyalar']
            ]).resize().oneTime();
            return ctx.editMessageText('✅ Obuna tasdiqlandi! Admin panelga xush kelibsiz!');
        }
        
        const userKeyboard = Markup.keyboard([
            ['🎮 PUBG Cheatlar', '🔥 Free Fire'],
            ['🔫 Call of Duty', '⛏️ Minecraft'],
            ['🔍 Qidirish', '📁 Barcha kontent'],
            ['🏠 Bosh menyu']
        ]).resize().oneTime();
        
        await ctx.deleteMessage();
        return ctx.reply('✅ Obuna tasdiqlandi! Endi cheat kodlarni olishingiz mumkin!', userKeyboard);
    }

    const keyboard = await getSubscriptionKeyboard();
    ctx.editMessageText('Hali barcha kanal va guruhlarga obuna boʻlmagansiz:', keyboard);
});

// BEKOR QILISH
bot.action('cancel_operation', async (ctx) => {
    await ctx.answerCbQuery('❌ Bekor qilindi');
    resetSession(ctx);
    await ctx.editMessageText('❌ Operatsiya bekor qilindi.');
});

// KATEGORIYA TANLASH - KONTENT QO'SHISH UCHUN
bot.action(/category_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const category = ctx.match[1];
    
    // KONTENT QO'SHISH JARAYONI
    if (ctx.session.waitingForCategory && ctx.session.contentData) {
        ctx.session.contentData.category = category;
        ctx.session.waitingForCategory = false;
        ctx.session.waitingForCode = true;
        
        await ctx.editMessageText(`✅ Kategoriya tanlandi: ${category}\n\nEndi ushbu kontent uchun kod yuboring (masalan: pubg_aimbot_01):\n\n❌ Bekor qilish: /cancel`);
    } 
    // Foydalanuvchi kategoriya tanladi (faqat ko'rish uchun)
    else {
        try {
            const contents = await Content.find({ category: category }).sort({ date: -1 }).limit(10);
            
            if (contents.length === 0) {
                return ctx.editMessageText(`❌ ${category} kategoriyasida hozircha kontent yoʻq.\n\nBoshqa kategoriyani tanlang yoki admin bilan bogʻlaning.`);
            }
            
            let message = `🎮 ${category} - Soʻngi 10 ta kontent:\n\n`;
            contents.forEach((content, index) => {
                message += `${index + 1}. Kod: ${content.code}\n`;
                message += `   📝 ${content.caption ? content.caption.substring(0, 50) + '...' : 'Izohsiz'}\n`;
                message += `   ⬇️ Yuklab olishlar: ${content.downloads}\n\n`;
            });
            
            message += `\nKontent olish uchun kodni yuboring (masalan: ${contents[0].code})`;
            
            await ctx.editMessageText(message);
        } catch (err) {
            console.error(err);
            await ctx.editMessageText('❌ Xatolik yuz berdi. Qayta urinib koʻring.');
        }
    }
});

// ADMIN COMMANDS
bot.hears('➕ Cheat qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('Bu buyruq faqat adminlar uchun!');
    
    resetSession(ctx);
    ctx.session.addingContent = true;
    
    ctx.reply('🎮 Yangi cheat/kontent qoʻshish:\n\n1. Avval kontentni yuboring (video, dokument, rasm yoki audio)\n2. Keyin kategoriya tanlaysiz\n3. Kod kiritasiz\n\n❌ Bekor qilish: /cancel');
});

bot.hears('📊 Statistika', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    try {
        const users = await User.countDocuments();
        const contents = await Content.countDocuments();
        const subs = await Subscription.countDocuments();
        
        const categories = await Content.aggregate([
            { $group: { _id: "$category", count: { $sum: 1 }, downloads: { $sum: "$downloads" } } }
        ]);
        
        const topContents = await Content.find().sort({ downloads: -1 }).limit(5);
        const lastActive = await User.findOne().sort({ last_activity: -1 });
        
        let stats = `📊 BOT STATISTIKASI:\n\n`;
        stats += `👥 Foydalanuvchilar: ${users}\n`;
        stats += `🎮 Kontentlar: ${contents}\n`;
        stats += `📢 Majburiy obunalar: ${subs}\n\n`;
        
        stats += `📁 Kategoriyalar:\n`;
        categories.forEach(cat => {
            stats += `  ${cat._id}: ${cat.count} ta (⬇️ ${cat.downloads})\n`;
        });
        
        stats += `\n🏆 Top 5 kontent:\n`;
        topContents.forEach((content, i) => {
            stats += `  ${i+1}. ${content.code}: ${content.downloads} yuklab olish\n`;
        });
        
        if (lastActive) {
            const lastActiveTime = new Date(lastActive.last_activity);
            stats += `\n⏰ Oxirgi faollik: ${lastActiveTime.toLocaleString()}`;
        }
        
        ctx.reply(stats);
    } catch (err) {
        console.error(err);
        ctx.reply('Statistika olishda xatolik');
    }
});

bot.hears('🔍 Kontent qidirish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    resetSession(ctx);
    ctx.session.searchMode = true;
    ctx.reply('🔍 Kontent qidirish:\n\nQidirmoqchi boʻlgan kontent kodi yoki kalit soʻzni yuboring:\n\n❌ Bekor qilish: /cancel');
});

bot.hears('📢 Broadcast', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    resetSession(ctx);
    ctx.session.broadcasting = true;
    ctx.reply('📢 Broadcast rejimi:\n\nBarcha foydalanuvchilarga yubormoqchi boʻlgan kontentni yuboring:\n\n❌ Bekor qilish: /cancel');
});

bot.hears('➕ Kanal qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    resetSession(ctx);
    ctx.session.awaitingChannel = true;
    
    ctx.reply('➕ Yangi kanal qoʻshish:\n\nKanal username va nomini yuboring (format: @username KanalNomi):\n\nMasalan: @gamecheats Game Cheats\n\n❌ Bekor qilish: /cancel');
});

bot.hears('➕ Guruh qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    resetSession(ctx);
    ctx.session.awaitingGroup = true;
    
    ctx.reply('➕ Yangi guruh qoʻshish:\n\nGuruh username va nomini yuboring (format: @username GuruhNomi):\n\nMasalan: @gamerschat Gamers Chat\n\n❌ Bekor qilish: /cancel');
});

bot.hears('📋 Obunalar roʻyxati', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    const subs = await Subscription.find({});
    if (subs.length === 0) return ctx.reply('📭 Hozircha majburiy obuna yoʻq.');
    
    const list = subs.map((s, i) => 
        `${i+1}. ${s.type === 'channel' ? '📢' : '👥'} ${s.name || s.chat_username} (${s.chat_username})`
    ).join('\n');
    
    ctx.reply(`📋 Majburiy obunalar roʻyxati:\n\n${list}\n\nJami: ${subs.length} ta`);
});

bot.hears('➖ Obunani oʻchirish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    resetSession(ctx);
    ctx.session.deletingSub = true;
    ctx.reply('➖ Obunani oʻchirish:\n\nOʻchirish uchun kanal yoki guruh username ni yuboring:\n\n❌ Bekor qilish: /cancel');
});

bot.hears('🎮 Kategoriyalar', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    const categories = ['PUBG', 'Free Fire', 'Call of Duty', 'Minecraft', 'Other'];
    let message = '🎮 Mavjud kategoriyalar:\n\n';
    
    for (const category of categories) {
        const count = await Content.countDocuments({ category: category });
        message += `${category}: ${count} ta kontent\n`;
    }
    
    ctx.reply(message);
});

// USER KATEGORIYALAR
bot.hears('🎮 PUBG Cheatlar', async (ctx) => {
    await showCategoryContents(ctx, 'PUBG');
});

bot.hears('🔥 Free Fire', async (ctx) => {
    await showCategoryContents(ctx, 'Free Fire');
});

bot.hears('🔫 Call of Duty', async (ctx) => {
    await showCategoryContents(ctx, 'Call of Duty');
});

bot.hears('⛏️ Minecraft', async (ctx) => {
    await showCategoryContents(ctx, 'Minecraft');
});

bot.hears('📁 Barcha kontent', async (ctx) => {
    await addUser(ctx);
    const isSubscribed = await checkAllSubscriptions(ctx.from.id);
    if (!isSubscribed && !isAdmin(ctx.from.id)) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply('Botdan foydalanish uchun avval obuna boʻling:', keyboard);
    }
    
    try {
        const contents = await Content.find().sort({ date: -1 }).limit(20);
        
        if (contents.length === 0) {
            return ctx.reply('❌ Hozircha kontent yoʻq.');
        }
        
        let message = '📁 Barcha kontentlar:\n\n';
        contents.forEach((content, index) => {
            message += `${index + 1}. ${content.category} - ${content.code}\n`;
            message += `   📝 ${content.caption ? content.caption.substring(0, 40) + '...' : 'Izohsiz'}\n`;
            message += `   ⬇️ ${content.downloads} yuklab olish\n\n`;
        });
        
        message += `\nKontent olish uchun kodni yuboring (masalan: ${contents[0].code})`;
        
        ctx.reply(message);
    } catch (err) {
        ctx.reply('❌ Xatolik yuz berdi. Qayta urinib koʻring.');
    }
});

bot.hears('🔍 Qidirish', (ctx) => {
    resetSession(ctx);
    ctx.session.userSearch = true;
    ctx.reply('🔍 Kontent qidirish:\n\nQidirmoqchi boʻlgan kontent kodi yoki kalit soʻzni yuboring:\n\n❌ Bekor qilish: /cancel');
});

// KONTENT QABUL QILISH (VIDEO, DOCUMENT, PHOTO, AUDIO)
bot.on(['video', 'document', 'photo', 'audio'], async (ctx) => {
    if (!isAdmin(ctx.from.id) || !ctx.session.addingContent) return;
    
    let fileId, fileType;
    
    if (ctx.message.video) {
        fileId = ctx.message.video.file_id;
        fileType = 'video';
    } else if (ctx.message.document) {
        fileId = ctx.message.document.file_id;
        fileType = 'document';
    } else if (ctx.message.photo) {
        fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        fileType = 'photo';
    } else if (ctx.message.audio) {
        fileId = ctx.message.audio.file_id;
        fileType = 'audio';
    }
    
    // Sessionda contentData mavjudligini tekshirish
    if (!ctx.session.contentData) {
        ctx.session.contentData = {};
    }
    
    ctx.session.contentData = {
        file_id: fileId,
        file_type: fileType,
        caption: ctx.message.caption || '',
        added_by: ctx.from.id
    };
    
    ctx.session.waitingForCategory = true;
    ctx.session.addingContent = false;
    
    const fileInfo = `✅ ${fileType === 'video' ? '📹 Video' : 
                     fileType === 'document' ? '📄 Dokument' : 
                     fileType === 'photo' ? '🖼️ Rasm' : '🎵 Audio'} qabul qilindi!\n\n` +
                    `📝 Izoh: ${ctx.session.contentData.caption || 'Yoʻq'}\n\n` +
                    `Endi kategoriya tanlang:`;
    
    await ctx.reply(fileInfo, getCategoryKeyboard());
});

// TEXT HANDLER
bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;
    
    // Cancel command
    if (text === '/cancel') {
        resetSession(ctx);
        return ctx.reply('❌ Jarayon bekor qilindi.');
    }
    
    // Admin commands
    if (isAdmin(userId)) {
        // Kanal qo'shish
        if (ctx.session.awaitingChannel) {
            const parts = text.split(' ');
            if (parts.length < 2) {
                return ctx.reply('❌ Format notoʻgʻri. Format: @username KanalNomi');
            }
            
            const username = parts[0];
            const name = parts.slice(1).join(' ');
            
            if (!username.startsWith('@')) {
                return ctx.reply('❌ Username @ bilan boshlanishi kerak.');
            }
            
            try {
                await Subscription.create({ 
                    chat_username: username, 
                    type: 'channel',
                    name: name
                });
                ctx.session.awaitingChannel = false;
                return ctx.reply(`✅ ${name} (${username}) kanali muvaffaqiyatli qoʻshildi!`);
            } catch (err) {
                if (err.code === 11000) {
                    return ctx.reply(`❌ ${username} kanali allaqachon mavjud.`);
                }
                return ctx.reply('❌ Xatolik yuz berdi. Qayta urinib koʻring.');
            }
        }
        
        // Guruh qo'shish
        if (ctx.session.awaitingGroup) {
            const parts = text.split(' ');
            if (parts.length < 2) {
                return ctx.reply('❌ Format notoʻgʻri. Format: @username GuruhNomi');
            }
            
            const username = parts[0];
            const name = parts.slice(1).join(' ');
            
            if (!username.startsWith('@')) {
                return ctx.reply('❌ Username @ bilan boshlanishi kerak.');
            }
            
            try {
                await Subscription.create({ 
                    chat_username: username, 
                    type: 'group',
                    name: name
                });
                ctx.session.awaitingGroup = false;
                return ctx.reply(`✅ ${name} (${username}) guruhi muvaffaqiyatli qoʻshildi!`);
            } catch (err) {
                if (err.code === 11000) {
                    return ctx.reply(`❌ ${username} guruhi allaqachon mavjud.`);
                }
                return ctx.reply('❌ Xatolik yuz berdi. Qayta urinib koʻring.');
            }
        }
        
        // Obunani o'chirish
        if (ctx.session.deletingSub) {
            const result = await Subscription.deleteOne({ chat_username: text });
            ctx.session.deletingSub = false;
            
            if (result.deletedCount > 0) {
                return ctx.reply(`✅ ${text} obunasi muvaffaqiyatli oʻchirildi.`);
            } else {
                return ctx.reply('❌ Bunday obuna topilmadi.');
            }
        }
        
        // Kontent qidirish (admin)
        if (ctx.session.searchMode) {
            try {
                const searchQuery = text;
                const contents = await Content.find({
                    $or: [
                        { code: { $regex: searchQuery, $options: 'i' } },
                        { caption: { $regex: searchQuery, $options: 'i' } },
                        { tags: { $regex: searchQuery, $options: 'i' } }
                    ]
                }).limit(10);
                
                ctx.session.searchMode = false;
                
                if (contents.length === 0) {
                    return ctx.reply(`❌ "${searchQuery}" boʻyicha hech narsa topilmadi.`);
                }
                
                let message = `🔍 "${searchQuery}" boʻyicha natijalar (${contents.length} ta):\n\n`;
                contents.forEach((content, index) => {
                    message += `${index + 1}. ${content.category} - ${content.code}\n`;
                    message += `   📝 ${content.caption ? content.caption.substring(0, 50) + '...' : 'Izohsiz'}\n`;
                    message += `   ⬇️ ${content.downloads} | 📅 ${new Date(content.date).toLocaleDateString()}\n\n`;
                });
                
                message += `\nKontent olish uchun kodni yuboring (masalan: ${contents[0].code})`;
                
                ctx.reply(message);
            } catch (err) {
                ctx.session.searchMode = false;
                console.error(err);
                ctx.reply('❌ Qidirishda xatolik yuz berdi.');
            }
            return;
        }
        
        // Kod qabul qilish (kontent qo'shish)
        if (ctx.session.waitingForCode && ctx.session.contentData) {
            const code = text.trim();
            
            // Kodni tekshirish
            if (!/^[a-zA-Z0-9_.-]+$/.test(code)) {
                return ctx.reply('❌ Kod faqat harf, raqam, nuqta, tire va pastki chiziqdan iborat boʻlishi kerak. Qayta kiriting:');
            }
            
            try {
                // Kod bormi tekshirish
                const existing = await Content.findOne({ code: code });
                if (existing) {
                    return ctx.reply(`❌ "${code}" kodi allaqachon ishlatilgan. Boshqa kod kiriting:\n\n❌ Bekor qilish: /cancel`);
                }
                
                // Kontentni saqlash
                await Content.create({
                    code: code,
                    file_id: ctx.session.contentData.file_id,
                    file_type: ctx.session.contentData.file_type,
                    caption: ctx.session.contentData.caption,
                    category: ctx.session.contentData.category,
                    added_by: userId
                });
                
                // Muvaffaqiyatli saqlash xabari
                const fileTypeEmoji = ctx.session.contentData.file_type === 'video' ? '📹' :
                                     ctx.session.contentData.file_type === 'document' ? '📄' :
                                     ctx.session.contentData.file_type === 'photo' ? '🖼️' : '🎵';
                
                await ctx.reply(`✅ "${code}" kodli kontent muvaffaqiyatli saqlandi!\n\n` +
                               `${fileTypeEmoji} Turi: ${ctx.session.contentData.file_type}\n` +
                               `🎮 Kategoriya: ${ctx.session.contentData.category}\n\n` +
                               `Endi foydalanuvchilar bu kod orqali kontentni olishlari mumkin.`);
                
                // Sessionni tozalash
                resetSession(ctx);
                
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
                        
                        await new Promise(resolve => setTimeout(resolve, 30));
                    } catch (e) {
                        failed++;
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
    
    // User qidirish
    if (ctx.session.userSearch) {
        await handleUserSearch(ctx, text);
        return;
    }
    
    // Obuna tekshirish
    const isSubscribed = await checkAllSubscriptions(userId);
    if (!isSubscribed && !isAdmin(userId)) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply('Botdan foydalanish uchun avval barcha kanal va guruhlarga obuna boʻling:', keyboard);
    }
    
    // Kontent qidirish (kod bo'yicha)
    await handleContentRequest(ctx, text);
});

// BROADCAST HANDLER
bot.on(['sticker', 'animation', 'voice'], async (ctx) => {
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
                await new Promise(resolve => setTimeout(resolve, 30));
            } catch (e) {
                failed++;
            }
        }
        
        ctx.session.broadcasting = false;
        
        ctx.reply(`✅ Broadcast yakunlandi!\n\n✅ Muvaffaqiyatli: ${success} ta\n❌ Xatolik: ${failed} ta`);
    } catch (err) {
        ctx.session.broadcasting = false;
        ctx.reply('❌ Broadcastda xatolik yuz berdi.');
    }
});

// YORDAMCHI FUNKSIYALAR
async function showCategoryContents(ctx, category) {
    await addUser(ctx);
    const isSubscribed = await checkAllSubscriptions(ctx.from.id);
    if (!isSubscribed && !isAdmin(ctx.from.id)) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply('Botdan foydalanish uchun avval obuna boʻling:', keyboard);
    }
    
    try {
        const contents = await Content.find({ category: category }).sort({ date: -1 }).limit(15);
        
        if (contents.length === 0) {
            return ctx.reply(`❌ ${category} kategoriyasida hozircha kontent yoʻq.`);
        }
        
        let message = `🎮 ${category} kontentlari:\n\n`;
        contents.forEach((content, index) => {
            message += `${index + 1}. ${content.code}\n`;
            if (content.caption) {
                message += `   📝 ${content.caption.substring(0, 60)}${content.caption.length > 60 ? '...' : ''}\n`;
            }
            message += `   ⬇️ ${content.downloads} yuklab olish\n\n`;
        });
        
        message += `\nKontent olish uchun kodni yuboring (masalan: ${contents[0].code})`;
        
        ctx.reply(message);
    } catch (err) {
        ctx.reply('❌ Xatolik yuz berdi. Qayta urinib koʻring.');
    }
}

async function handleUserSearch(ctx, searchQuery) {
    try {
        const contents = await Content.find({
            $or: [
                { code: { $regex: searchQuery, $options: 'i' } },
                { caption: { $regex: searchQuery, $options: 'i' } },
                { category: { $regex: searchQuery, $options: 'i' } }
            ]
        }).limit(15);
        
        ctx.session.userSearch = false;
        
        if (contents.length === 0) {
            return ctx.reply(`❌ "${searchQuery}" boʻyicha hech narsa topilmadi.\n\nBoshqa soʻz yoki kod yuboring.`);
        }
        
        let message = `🔍 "${searchQuery}" boʻyicha natijalar (${contents.length} ta):\n\n`;
        contents.forEach((content, index) => {
            const categoryEmoji = content.category === 'PUBG' ? '🎮' :
                                 content.category === 'Free Fire' ? '🔥' :
                                 content.category === 'Call of Duty' ? '🔫' :
                                 content.category === 'Minecraft' ? '⛏️' : '📁';
            
            message += `${index + 1}. ${categoryEmoji} ${content.category} - ${content.code}\n`;
            message += `   📝 ${content.caption ? content.caption.substring(0, 50) + '...' : 'Izohsiz'}\n`;
            message += `   ⬇️ ${content.downloads} yuklab olish\n\n`;
        });
        
        message += `\nKontent olish uchun kodni yuboring (masalan: ${contents[0].code})`;
        
        ctx.reply(message);
    } catch (err) {
        ctx.session.userSearch = false;
        console.error(err);
        ctx.reply('❌ Qidirishda xatolik yuz berdi.');
    }
}

async function handleContentRequest(ctx, code) {
    try {
        const content = await Content.findOne({ code: code });
        if (!content) {
            return ctx.reply('❌ Bunday kodda kontent topilmadi.\n\nKodni tekshirib, qayta urinib koʻring yoki 🔍 Qidirish tugmasini bosing.');
        }
        
        // Foydalanuvchini qo'shish/yangilash
        await addUser(ctx);
        
        // Yuklab olishlar sonini oshirish
        await Content.updateOne(
            { _id: content._id },
            { $inc: { downloads: 1 } }
        );
        
        // Kontent turiga qarab yuborish
        const categoryEmoji = content.category === 'PUBG' ? '🎮' :
                             content.category === 'Free Fire' ? '🔥' :
                             content.category === 'Call of Duty' ? '🔫' :
                             content.category === 'Minecraft' ? '⛏️' : '📁';
        
        const caption = content.caption ? 
                       `${categoryEmoji} ${content.category}\n\n${content.caption}\n\nKod: ${content.code}\n⬇️ Yuklab olishlar: ${content.downloads + 1}` :
                       `${categoryEmoji} ${content.category} - Kod: ${content.code}\n⬇️ Yuklab olishlar: ${content.downloads + 1}`;
        
        switch (content.file_type) {
            case 'video':
                await ctx.replyWithVideo(content.file_id, { caption: caption });
                break;
            case 'document':
                await ctx.replyWithDocument(content.file_id, { caption: caption });
                break;
            case 'photo':
                await ctx.replyWithPhoto(content.file_id, { caption: caption });
                break;
            case 'audio':
                await ctx.replyWithAudio(content.file_id, { caption: caption });
                break;
        }
        
        // Qo'shimcha tavsiyalar
        setTimeout(async () => {
            try {
                const similarContents = await Content.find({ 
                    category: content.category,
                    code: { $ne: content.code }
                }).limit(3);
                
                if (similarContents.length > 0) {
                    let suggestions = `\n🔍 Shu kategoriyadagi boshqa kontentlar:\n\n`;
                    similarContents.forEach((item, i) => {
                        suggestions += `${i+1}. ${item.code} - ${item.caption ? item.caption.substring(0, 40) + '...' : ''}\n`;
                    });
                    suggestions += `\nOlish uchun kodni yuboring.`;
                    
                    await ctx.reply(suggestions);
                }
            } catch (err) {
                console.error('Tavsiyalar xatosi:', err);
            }
        }, 1000);
        
    } catch (err) {
        console.error('Kontent yuborish xatosi:', err);
        ctx.reply('❌ Kontent yuborishda xatolik yuz berdi. Iltimos, qayta urinib koʻring.');
    }
}

// WEBHOOK SOZLASH
if (URL) {
    const express = require('express');
    const app = express();
    
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    const fullUrl = `${URL}${webhookPath}`;
    
    bot.telegram.setWebhook(fullUrl, {
        secret_token: WEBHOOK_SECRET
    }).then(() => {
        console.log(`✅ Webhook o'rnatildi: ${fullUrl}`);
    }).catch(err => {
        console.error('❌ Webhook o\'rnatishda xato:', err.message);
    });
    
    app.use(express.json());
    
    app.post(webhookPath, (req, res) => {
        if (req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
            return res.status(403).send('Forbidden');
        }
        return bot.webhookCallback(webhookPath)(req, res);
    });
    
    app.get('/', (req, res) => {
        res.send('🎮 Game Cheat Media Bot ishlamoqda!');
    });
    
    app.get('/status', async (req, res) => {
        try {
            const users = await User.countDocuments();
            const contents = await Content.countDocuments();
            const downloads = await Content.aggregate([
                { $group: { _id: null, total: { $sum: "$downloads" } } }
            ]);
            
            res.json({
                status: 'online',
                users: users,
                contents: contents,
                total_downloads: downloads[0]?.total || 0,
                uptime: process.uptime()
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    
    app.listen(PORT, () => {
        console.log(`🚀 Server ${PORT} portda ishga tushdi`);
        console.log(`🌐 Webhook URL: ${fullUrl}`);
    });
} else {
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

console.log('🎮 Game Cheat Media Bot ishga tushirilmoqda...');
