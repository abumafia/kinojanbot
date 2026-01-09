const { Telegraf, Markup, session } = require('telegraf');
const mongoose = require('mongoose');

// SOZLAMALAR
const BOT_TOKEN = '8554385155:AAGLJ4-GOlP_768TuAkne8OH4PX7dAnXW6g';
const MONGODB_URL = 'mongodb+srv://abumafia0:abumafia0@abumafia.h1trttg.mongodb.net/kitoblar_db?appName=abumafia';

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

const bookSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    file_id: { type: String, required: true },
    file_name: String,
    file_size: Number,
    title: { type: String, required: true },
    author: String,
    description: String,
    category: { 
        type: String, 
        enum: [
            'Adabiyot', 
            'Darslik', 
            'Ilmiy', 
            'Roman', 
            'Sheʼr', 
            'Diniy', 
            'Biznes', 
            'Texnika', 
            'Boshqa'
        ], 
        default: 'Adabiyot' 
    },
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
const Book = mongoose.model('Book', bookSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);

// Bot yaratish
const bot = new Telegraf(BOT_TOKEN);
bot.use(session({
    defaultSession: () => ({
        addingBook: false,
        broadcasting: false,
        bookData: null,
        waitingForCode: false,
        waitingForCategory: false,
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
            Markup.button.callback('📚 Adabiyot', 'category_Adabiyot'),
            Markup.button.callback('📖 Darslik', 'category_Darslik')
        ],
        [
            Markup.button.callback('🔬 Ilmiy', 'category_Ilmiy'),
            Markup.button.callback('📖 Roman', 'category_Roman')
        ],
        [
            Markup.button.callback('✍️ Sheʼr', 'category_Sheʼr'),
            Markup.button.callback('🕌 Diniy', 'category_Diniy')
        ],
        [
            Markup.button.callback('💼 Biznes', 'category_Biznes'),
            Markup.button.callback('🔧 Texnika', 'category_Texnika')
        ],
        [
            Markup.button.callback('📁 Boshqa', 'category_Boshqa')
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
    ctx.session.addingBook = false;
    ctx.session.broadcasting = false;
    ctx.session.bookData = null;
    ctx.session.waitingForCode = false;
    ctx.session.waitingForCategory = false;
    ctx.session.searchMode = false;
    ctx.session.userSearch = false;
    ctx.session.awaitingChannel = false;
    ctx.session.awaitingGroup = false;
    ctx.session.deletingSub = false;
}

// Kitob nomini avtomatik aniqlash
function extractBookInfo(caption) {
    if (!caption) return { title: 'Nomsiz kitob', author: 'Nomaʼlum' };
    
    // Matnni qatorlarga ajratish
    const lines = caption.split('\n').filter(line => line.trim());
    
    let title = 'Nomsiz kitob';
    let author = 'Nomaʼlum';
    let description = '';
    
    // Birinchi qatordan nom olish
    if (lines.length > 0) {
        title = lines[0].trim();
        
        // Ikkinchi qatordan muallif olish
        if (lines.length > 1) {
            const secondLine = lines[1].trim().toLowerCase();
            if (secondLine.includes('muallif:') || secondLine.includes('author:') || 
                secondLine.includes('yozuvchi:') || secondLine.includes('avtor:')) {
                author = lines[1].replace(/.*?:/i, '').trim();
            } else {
                author = lines[1].trim();
            }
        }
        
        // Qolgan qatorlarni tavsif uchun
        if (lines.length > 2) {
            description = lines.slice(2).join('\n');
        }
    }
    
    return { title, author, description };
}

// START HANDLER
bot.start(async (ctx) => {
    await addUser(ctx);
    const userId = ctx.from.id;
    const isSubscribed = await checkAllSubscriptions(userId);

    if (!isSubscribed && !isAdmin(userId)) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply('📚 Online Kitoblar Botiga xush kelibsiz!\n\nBotdan foydalanish uchun quyidagi kanal va guruhlarga obuna boʻling:', keyboard);
    }

    if (isAdmin(userId)) {
        const adminKeyboard = Markup.keyboard([
            ['➕ Kitob qoʻshish', '📊 Statistika'],
            ['📢 Broadcast', '🔍 Kitob qidirish'],
            ['➕ Kanal qoʻshish', '➕ Guruh qoʻshish'],
            ['📋 Obunalar roʻyxati', '➖ Obunani oʻchirish'],
            ['🏠 Bosh menyu', '📚 Kategoriyalar']
        ]).resize().oneTime();
        return ctx.reply('👨‍💻 Admin panelga xush kelibsiz!\n\nKitoblarni boshqarishingiz mumkin.', adminKeyboard);
    }

    const userKeyboard = Markup.keyboard([
        ['📚 Adabiyot', '📖 Darslik'],
        ['🔬 Ilmiy', '📖 Roman'],
        ['✍️ Sheʼr', '🕌 Diniy'],
        ['💼 Biznes', '🔧 Texnika'],
        ['🔍 Qidirish', '📁 Barcha kitoblar'],
        ['🏠 Bosh menyu']
    ]).resize().oneTime();
    
    ctx.reply('📚 Online Kitoblar Botiga xush kelibsiz!\n\nTurli kategoriyalardagi elektron kitoblarni yuklab oling!\n\nKategoriya tanlang yoki kitob kodini yuboring:', userKeyboard);
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
            ['➕ Kitob qoʻshish', '📊 Statistika'],
            ['📢 Broadcast', '🔍 Kitob qidirish'],
            ['➕ Kanal qoʻshish', '➕ Guruh qoʻshish'],
            ['📋 Obunalar roʻyxati', '➖ Obunani oʻchirish'],
            ['🏠 Bosh menyu', '📚 Kategoriyalar']
        ]).resize().oneTime();
        return ctx.reply('Admin panel:', adminKeyboard);
    }

    const userKeyboard = Markup.keyboard([
        ['📚 Adabiyot', '📖 Darslik'],
        ['🔬 Ilmiy', '📖 Roman'],
        ['✍️ Sheʼr', '🕌 Diniy'],
        ['💼 Biznes', '🔧 Texnika'],
        ['🔍 Qidirish', '📁 Barcha kitoblar'],
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
                ['➕ Kitob qoʻshish', '📊 Statistika'],
                ['📢 Broadcast', '🔍 Kitob qidirish'],
                ['➕ Kanal qoʻshish', '➕ Guruh qoʻshish'],
                ['📋 Obunalar roʻyxati', '➖ Obunani oʻchirish'],
                ['🏠 Bosh menyu', '📚 Kategoriyalar']
            ]).resize().oneTime();
            return ctx.editMessageText('✅ Obuna tasdiqlandi! Admin panelga xush kelibsiz!');
        }
        
        const userKeyboard = Markup.keyboard([
            ['📚 Adabiyot', '📖 Darslik'],
            ['🔬 Ilmiy', '📖 Roman'],
            ['✍️ Sheʼr', '🕌 Diniy'],
            ['💼 Biznes', '🔧 Texnika'],
            ['🔍 Qidirish', '📁 Barcha kitoblar'],
            ['🏠 Bosh menyu']
        ]).resize().oneTime();
        
        await ctx.deleteMessage();
        return ctx.reply('✅ Obuna tasdiqlandi! Endi kitoblarni yuklab olishingiz mumkin!', userKeyboard);
    }

    const keyboard = await getSubscriptionKeyboard();
    ctx.editMessageText('Hali barcha kanal va guruhlarga obuna boʻlmagansiz:', keyboard);
});

// KATEGORIYA TANLASH (kitob qo'shish uchun)
bot.action(/category_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const category = ctx.match[1];
    
    // KITOB QO'SHISH JARAYONI
    if (ctx.session.bookData && ctx.session.waitingForCategory) {
        ctx.session.bookData.category = category;
        ctx.session.waitingForCategory = false;
        ctx.session.waitingForCode = true;
        
        // Taklif qilingan kodni ko'rsatish
        const suggestedCode = generateSuggestedCode(ctx.session.bookData.title, category);
        
        await ctx.editMessageText(`✅ Kategoriya tanlandi: ${category}\n\n` +
                                 `📖 Kitob: ${ctx.session.bookData.title}\n` +
                                 `✍️ Muallif: ${ctx.session.bookData.author}\n\n` +
                                 `Endi kitob uchun kod yuboring:\n\n` +
                                 `Masalan: ${suggestedCode}\n` +
                                 `Yoki o'zingiz istagan kodni kiriting.\n\n` +
                                 `❌ Bekor qilish: /cancel`);
    } 
    // Foydalanuvchi kategoriya tanladi (ko'rish uchun)
    else {
        await showCategoryBooks(ctx, category);
    }
});

// Taklif qilinadigan kod generatsiyasi
function generateSuggestedCode(title, category) {
    // Lotin harflariga o'tkazish
    let latinTitle = title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 20);
    
    const categoryCode = category.substring(0, 3).toLowerCase();
    
    return `${categoryCode}_${latinTitle}`;
}

// ADMIN COMMANDS
bot.hears('➕ Kitob qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('Bu buyruq faqat adminlar uchun!');
    
    resetSession(ctx);
    ctx.session.addingBook = true;
    
    ctx.reply('📚 Yangi kitob qoʻshish:\n\nBoshqa chatdan PDF faylini + matn bilan forward qiling.\n\nMatndan kitob nomi va muallif avtomatik olinadi.\n\nKeyin kategoriya tanlaysiz va kod kiritasiz.\n\n❌ Bekor qilish: /cancel');
});

bot.hears('📊 Statistika', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    try {
        const users = await User.countDocuments();
        const books = await Book.countDocuments();
        const subs = await Subscription.countDocuments();
        
        const categories = await Book.aggregate([
            { $group: { _id: "$category", count: { $sum: 1 }, downloads: { $sum: "$downloads" } } }
        ]);
        
        const topBooks = await Book.find().sort({ downloads: -1 }).limit(5);
        const lastActive = await User.findOne().sort({ last_activity: -1 });
        
        let stats = `📊 BOT STATISTIKASI:\n\n`;
        stats += `👥 Foydalanuvchilar: ${users}\n`;
        stats += `📚 Kitoblar: ${books}\n`;
        stats += `📢 Majburiy obunalar: ${subs}\n\n`;
        
        stats += `📁 Kategoriyalar:\n`;
        categories.forEach(cat => {
            stats += `  ${cat._id}: ${cat.count} ta (⬇️ ${cat.downloads})\n`;
        });
        
        stats += `\n🏆 Top 5 kitob:\n`;
        topBooks.forEach((book, i) => {
            stats += `  ${i+1}. "${book.title}" - ${book.downloads} yuklab olish\n`;
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

bot.hears('🔍 Kitob qidirish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    resetSession(ctx);
    ctx.session.searchMode = true;
    ctx.reply('🔍 Kitob qidirish:\n\nQidirmoqchi boʻlgan kitob nomi, muallifi yoki kodini yuboring:\n\n❌ Bekor qilish: /cancel');
});

bot.hears('📢 Broadcast', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    resetSession(ctx);
    ctx.session.broadcasting = true;
    ctx.reply('📢 Broadcast rejimi:\n\nBoshqa chatdan istalgan xabarni forward qiling:\n\n❌ Bekor qilish: /cancel');
});

bot.hears('➕ Kanal qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    resetSession(ctx);
    ctx.session.awaitingChannel = true;
    
    ctx.reply('➕ Yangi kanal qoʻshish:\n\nKanal username ni yuboring (@ bilan):\n\nMasalan: @kitoblar_olami\n\n❌ Bekor qilish: /cancel');
});

bot.hears('➕ Guruh qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    resetSession(ctx);
    ctx.session.awaitingGroup = true;
    
    ctx.reply('➕ Yangi guruh qoʻshish:\n\nGuruh username ni yuboring (@ bilan):\n\nMasalan: @kitob_muxlislari\n\n❌ Bekor qilish: /cancel');
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

bot.hears('📚 Kategoriyalar', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    const categories = ['Adabiyot', 'Darslik', 'Ilmiy', 'Roman', 'Sheʼr', 'Diniy', 'Biznes', 'Texnika', 'Boshqa'];
    let message = '📚 Mavjud kategoriyalar:\n\n';
    
    for (const category of categories) {
        const count = await Book.countDocuments({ category: category });
        message += `${category}: ${count} ta kitob\n`;
    }
    
    ctx.reply(message);
});

// USER KATEGORIYALAR
bot.hears('📚 Adabiyot', async (ctx) => {
    await showCategoryBooks(ctx, 'Adabiyot');
});

bot.hears('📖 Darslik', async (ctx) => {
    await showCategoryBooks(ctx, 'Darslik');
});

bot.hears('🔬 Ilmiy', async (ctx) => {
    await showCategoryBooks(ctx, 'Ilmiy');
});

bot.hears('📖 Roman', async (ctx) => {
    await showCategoryBooks(ctx, 'Roman');
});

bot.hears('✍️ Sheʼr', async (ctx) => {
    await showCategoryBooks(ctx, 'Sheʼr');
});

bot.hears('🕌 Diniy', async (ctx) => {
    await showCategoryBooks(ctx, 'Diniy');
});

bot.hears('💼 Biznes', async (ctx) => {
    await showCategoryBooks(ctx, 'Biznes');
});

bot.hears('🔧 Texnika', async (ctx) => {
    await showCategoryBooks(ctx, 'Texnika');
});

bot.hears('📁 Barcha kitoblar', async (ctx) => {
    await addUser(ctx);
    const isSubscribed = await checkAllSubscriptions(ctx.from.id);
    if (!isSubscribed && !isAdmin(ctx.from.id)) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply('Botdan foydalanish uchun avval obuna boʻling:', keyboard);
    }
    
    try {
        const books = await Book.find().sort({ date: -1 }).limit(20);
        
        if (books.length === 0) {
            return ctx.reply('❌ Hozircha kitob yoʻq.');
        }
        
        let message = '📚 Barcha kitoblar:\n\n';
        books.forEach((book, index) => {
            message += `${index + 1}. ${book.category} - ${book.title}\n`;
            message += `   ✍️ ${book.author || 'Nomaʼlum'}\n`;
            message += `   🆔 Kod: ${book.code}\n`;
            message += `   ⬇️ ${book.downloads} yuklab olish\n\n`;
        });
        
        message += `\nKitob olish uchun kodni yuboring (masalan: ${books[0].code})`;
        
        ctx.reply(message);
    } catch (err) {
        ctx.reply('❌ Xatolik yuz berdi. Qayta urinib koʻring.');
    }
});

bot.hears('🔍 Qidirish', (ctx) => {
    resetSession(ctx);
    ctx.session.userSearch = true;
    ctx.reply('🔍 Kitob qidirish:\n\nQidirmoqchi boʻlgan kitob nomi, muallifi yoki kodini yuboring:\n\n❌ Bekor qilish: /cancel');
});

// PDF QABUL QILISH (kitob qo'shish uchun)
bot.on('document', async (ctx) => {
    if (!isAdmin(ctx.from.id) || !ctx.session.addingBook) return;
    
    const document = ctx.message.document;
    const caption = ctx.message.caption || '';
    
    // Faqat PDF fayllarni qabul qilish
    if (!document.mime_type.includes('pdf') && !document.file_name.toLowerCase().endsWith('.pdf')) {
        return ctx.reply('❌ Faqat PDF fayllar qabul qilinadi. PDF kitob yuboring.');
    }
    
    // Kitob ma'lumotlarini avtomatik o'qish
    const bookInfo = extractBookInfo(caption);
    
    // Sessionda bookData yaratish
    ctx.session.bookData = {
        file_id: document.file_id,
        file_name: document.file_name,
        file_size: document.file_size,
        title: bookInfo.title,
        author: bookInfo.author,
        description: bookInfo.description,
        added_by: ctx.from.id
    };
    
    ctx.session.addingBook = false;
    ctx.session.waitingForCategory = true;
    
    const fileInfo = `✅ PDF kitob qabul qilindi!\n\n` +
                    `📖 Nomi: ${bookInfo.title}\n` +
                    `✍️ Muallif: ${bookInfo.author}\n` +
                    `📄 Fayl: ${document.file_name}\n` +
                    `📊 Hajmi: ${(document.file_size / (1024*1024)).toFixed(2)} MB\n\n` +
                    `Kitob kategoriyasini tanlang:`;
    
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
            const username = text.startsWith('@') ? text : `@${text}`;
            
            try {
                await Subscription.create({ 
                    chat_username: username, 
                    type: 'channel',
                    name: username
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
            const username = text.startsWith('@') ? text : `@${text}`;
            
            try {
                await Subscription.create({ 
                    chat_username: username, 
                    type: 'group',
                    name: username
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
            const result = await Subscription.deleteOne({ chat_username: text });
            ctx.session.deletingSub = false;
            
            if (result.deletedCount > 0) {
                return ctx.reply(`✅ ${text} obunasi muvaffaqiyatli oʻchirildi.`);
            } else {
                return ctx.reply('❌ Bunday obuna topilmadi.');
            }
        }
        
        // Kitob qidirish (admin)
        if (ctx.session.searchMode) {
            await handleAdminSearch(ctx, text);
            return;
        }
        
        // Kod qabul qilish (kitob qo'shish)
        if (ctx.session.waitingForCode && ctx.session.bookData) {
            await handleBookCode(ctx, text);
            return;
        }
    }
    
    // User qidirish
    if (ctx.session.userSearch) {
        await handleUserSearch(ctx, text);
        return;
    }
    
    // Broadcast (forward qilingan xabarlar uchun)
    if (ctx.session.broadcasting) {
        // Agar forward qilingan xabar bo'lsa
        if (ctx.message.forward_from_message_id) {
            await handleBroadcast(ctx);
            return;
        }
        // Agar oddiy matn bo'lsa
        else {
            await handleBroadcast(ctx);
            return;
        }
    }
    
    // Obuna tekshirish
    const isSubscribed = await checkAllSubscriptions(userId);
    if (!isSubscribed && !isAdmin(userId)) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply('Botdan foydalanish uchun avval barcha kanal va guruhlarga obuna boʻling:', keyboard);
    }
    
    // Kitob qidirish (kod bo'yicha)
    await handleBookRequest(ctx, text);
});

// BROADCAST HANDLER (barcha turdagi xabarlar uchun)
bot.on(['photo', 'video', 'audio', 'voice', 'sticker', 'animation'], async (ctx) => {
    if (!isAdmin(ctx.from.id) || !ctx.session.broadcasting) return;
    
    await handleBroadcast(ctx);
});

// YORDAMCHI FUNKSIYALAR
async function showCategoryBooks(ctx, category) {
    await addUser(ctx);
    const isSubscribed = await checkAllSubscriptions(ctx.from.id);
    if (!isSubscribed && !isAdmin(ctx.from.id)) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply('Botdan foydalanish uchun avval obuna boʻling:', keyboard);
    }
    
    try {
        const books = await Book.find({ category: category }).sort({ date: -1 }).limit(15);
        
        if (books.length === 0) {
            return ctx.reply(`❌ ${category} kategoriyasida hozircha kitob yoʻq.`);
        }
        
        let message = `📚 ${category} kitoblari:\n\n`;
        books.forEach((book, index) => {
            message += `${index + 1}. ${book.title}\n`;
            message += `   ✍️ ${book.author || 'Nomaʼlum'}\n`;
            message += `   🆔 Kod: ${book.code}\n`;
            message += `   ⬇️ ${book.downloads} yuklab olish\n\n`;
        });
        
        message += `\nKitob olish uchun kodni yuboring (masalan: ${books[0].code})`;
        
        ctx.reply(message);
    } catch (err) {
        ctx.reply('❌ Xatolik yuz berdi. Qayta urinib koʻring.');
    }
}

async function handleAdminSearch(ctx, text) {
    try {
        const searchQuery = text;
        const books = await Book.find({
            $or: [
                { code: { $regex: searchQuery, $options: 'i' } },
                { title: { $regex: searchQuery, $options: 'i' } },
                { author: { $regex: searchQuery, $options: 'i' } },
                { description: { $regex: searchQuery, $options: 'i' } }
            ]
        }).limit(10);
        
        ctx.session.searchMode = false;
        
        if (books.length === 0) {
            return ctx.reply(`❌ "${searchQuery}" boʻyicha hech narsa topilmadi.`);
        }
        
        let message = `🔍 "${searchQuery}" boʻyicha natijalar (${books.length} ta):\n\n`;
        books.forEach((book, index) => {
            message += `${index + 1}. ${book.category} - ${book.title}\n`;
            message += `   ✍️ ${book.author || 'Nomaʼlum'}\n`;
            message += `   🆔 Kod: ${book.code}\n`;
            message += `   ⬇️ ${book.downloads} yuklab olish\n\n`;
        });
        
        message += `\nKitob olish uchun kodni yuboring (masalan: ${books[0].code})`;
        
        ctx.reply(message);
    } catch (err) {
        ctx.session.searchMode = false;
        console.error(err);
        ctx.reply('❌ Qidirishda xatolik yuz berdi.');
    }
}

async function handleBookCode(ctx, text) {
    const code = text.trim();
    
    // Kodni tekshirish
    if (!/^[a-zA-Z0-9_.-]+$/.test(code)) {
        return ctx.reply('❌ Kod faqat harf, raqam, nuqta, tire va pastki chiziqdan iborat boʻlishi kerak. Qayta kiriting:');
    }
    
    // Kod uzunligi tekshirish
    if (code.length < 3 || code.length > 50) {
        return ctx.reply('❌ Kod uzunligi 3 dan 50 gacha belgidan iborat boʻlishi kerak. Qayta kiriting:');
    }
    
    try {
        // Kod bormi tekshirish
        const existing = await Book.findOne({ code: code });
        if (existing) {
            return ctx.reply(`❌ "${code}" kodi allaqachon ishlatilgan. Boshqa kod kiriting:\n\n❌ Bekor qilish: /cancel`);
        }
        
        // Kitobni saqlash
        await Book.create({
            code: code,
            file_id: ctx.session.bookData.file_id,
            file_name: ctx.session.bookData.file_name,
            file_size: ctx.session.bookData.file_size,
            title: ctx.session.bookData.title,
            author: ctx.session.bookData.author,
            description: ctx.session.bookData.description,
            category: ctx.session.bookData.category,
            added_by: ctx.from.id
        });
        
        // Muvaffaqiyatli saqlash xabari
        await ctx.reply(`✅ Kitob muvaffaqiyatli saqlandi!\n\n` +
                       `📖 Nomi: ${ctx.session.bookData.title}\n` +
                       `✍️ Muallif: ${ctx.session.bookData.author}\n` +
                       `📁 Kategoriya: ${ctx.session.bookData.category}\n` +
                       `🆔 Kod: ${code}\n` +
                       `📊 Hajmi: ${(ctx.session.bookData.file_size / (1024*1024)).toFixed(2)} MB\n\n` +
                       `Foydalanuvchilar "${code}" kod orqali kitobni olishlari mumkin.`);
        
        // Sessionni tozalash
        resetSession(ctx);
        
    } catch (err) {
        console.error('Saqlash xatosi:', err);
        return ctx.reply('❌ Saqlashda xatolik yuz berdi. Qayta urinib koʻring.');
    }
}

async function handleBroadcast(ctx) {
    try {
        const users = await User.find({});
        let success = 0;
        let failed = 0;
        
        for (const user of users) {
            try {
                // Xabarni nusxalash
                await ctx.telegram.copyMessage(
                    user.user_id, 
                    ctx.chat.id, 
                    ctx.message.message_id
                );
                success++;
                
                // Spamdan saqlanish uchun kichik kutish
                await new Promise(resolve => setTimeout(resolve, 30));
            } catch (e) {
                failed++;
                console.error(`User ${user.user_id} xato:`, e.message);
            }
        }
        
        ctx.session.broadcasting = false;
        
        return ctx.reply(`✅ Xabar ${success} ta foydalanuvchiga yuborildi!\n\n✅ Muvaffaqiyatli: ${success} ta\n❌ Xatolik: ${failed} ta`);
    } catch (err) {
        ctx.session.broadcasting = false;
        console.error('Xabar yuborish xatosi:', err);
        return ctx.reply('❌ Xabar yuborishda xatolik yuz berdi.');
    }
}

async function handleUserSearch(ctx, text) {
    try {
        const searchQuery = text;
        const books = await Book.find({
            $or: [
                { code: { $regex: searchQuery, $options: 'i' } },
                { title: { $regex: searchQuery, $options: 'i' } },
                { author: { $regex: searchQuery, $options: 'i' } },
                { category: { $regex: searchQuery, $options: 'i' } }
            ]
        }).limit(15);
        
        ctx.session.userSearch = false;
        
        if (books.length === 0) {
            return ctx.reply(`❌ "${searchQuery}" boʻyicha hech narsa topilmadi.\n\nBoshqa soʻz yoki kod yuboring.`);
        }
        
        let message = `🔍 "${searchQuery}" boʻyicha natijalar (${books.length} ta):\n\n`;
        books.forEach((book, index) => {
            const categoryEmoji = book.category === 'Adabiyot' ? '📚' :
                                 book.category === 'Darslik' ? '📖' :
                                 book.category === 'Ilmiy' ? '🔬' :
                                 book.category === 'Roman' ? '📖' :
                                 book.category === 'Sheʼr' ? '✍️' :
                                 book.category === 'Diniy' ? '🕌' :
                                 book.category === 'Biznes' ? '💼' :
                                 book.category === 'Texnika' ? '🔧' : '📁';
            
            message += `${index + 1}. ${categoryEmoji} ${book.category} - ${book.title}\n`;
            message += `   ✍️ ${book.author || 'Nomaʼlum'}\n`;
            message += `   🆔 Kod: ${book.code}\n`;
            message += `   ⬇️ ${book.downloads} yuklab olish\n\n`;
        });
        
        message += `\nKitob olish uchun kodni yuboring (masalan: ${books[0].code})`;
        
        ctx.reply(message);
    } catch (err) {
        ctx.session.userSearch = false;
        console.error(err);
        ctx.reply('❌ Qidirishda xatolik yuz berdi.');
    }
}

async function handleBookRequest(ctx, code) {
    try {
        const book = await Book.findOne({ code: code });
        if (!book) {
            return ctx.reply('❌ Bunday kodda kitob topilmadi.\n\nKodni tekshirib, qayta urinib koʻring yoki 🔍 Qidirish tugmasini bosing.');
        }
        
        // Foydalanuvchini qo'shish/yangilash
        await addUser(ctx);
        
        // Yuklab olishlar sonini oshirish
        await Book.updateOne(
            { _id: book._id },
            { $inc: { downloads: 1 } }
        );
        
        // Kitob ma'lumotlari
        const categoryEmoji = book.category === 'Adabiyot' ? '📚' :
                             book.category === 'Darslik' ? '📖' :
                             book.category === 'Ilmiy' ? '🔬' :
                             book.category === 'Roman' ? '📖' :
                             book.category === 'Sheʼr' ? '✍️' :
                             book.category === 'Diniy' ? '🕌' :
                             book.category === 'Biznes' ? '💼' :
                             book.category === 'Texnika' ? '🔧' : '📁';
        
        let caption = `${categoryEmoji} ${book.category}\n\n`;
        caption += `📖 ${book.title}\n`;
        if (book.author) caption += `✍️ Muallif: ${book.author}\n`;
        if (book.file_name) caption += `📄 Fayl: ${book.file_name}\n`;
        if (book.description) caption += `\n📝 Tavsif: ${book.description}\n`;
        caption += `\n🆔 Kod: ${book.code}\n`;
        caption += `⬇️ Yuklab olishlar: ${book.downloads + 1}`;
        
        // PDF faylni yuborish
        await ctx.replyWithDocument(book.file_id, { caption: caption });
        
        // Qo'shimcha tavsiyalar
        setTimeout(async () => {
            try {
                const similarBooks = await Book.find({ 
                    category: book.category,
                    code: { $ne: book.code }
                }).limit(3);
                
                if (similarBooks.length > 0) {
                    let suggestions = `\n🔍 Shu kategoriyadagi boshqa kitoblar:\n\n`;
                    similarBooks.forEach((item, i) => {
                        suggestions += `${i+1}. ${item.code} - ${item.title} (${item.author || 'Nomaʼlum'})\n`;
                    });
                    suggestions += `\nOlish uchun kodni yuboring.`;
                    
                    await ctx.reply(suggestions);
                }
            } catch (err) {
                console.error('Tavsiyalar xatosi:', err);
            }
        }, 1000);
        
    } catch (err) {
        console.error('Kitob yuborish xatosi:', err);
        ctx.reply('❌ Kitob yuborishda xatolik yuz berdi. Iltimos, qayta urinib koʻring.');
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
        res.send('📚 Online Kitoblar Bot ishlamoqda!');
    });
    
    app.get('/status', async (req, res) => {
        try {
            const users = await User.countDocuments();
            const books = await Book.countDocuments();
            const downloads = await Book.aggregate([
                { $group: { _id: null, total: { $sum: "$downloads" } } }
            ]);
            
            res.json({
                status: 'online',
                users: users,
                books: books,
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

console.log('📚 Online Kitoblar Bot ishga tushirilmoqda...');
