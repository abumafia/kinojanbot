const { Telegraf, Markup, session } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');

// SOZLAMALAR
const BOT_TOKEN = '8504888393:AAHUV2fMIjvo00feV_tJhKtHdwhnX_eJNm8';
const MONGODB_URL = 'mongodb+srv://abumafia0:abumafia0@abumafia.h1trttg.mongodb.net/kinojanbot?appName=abumafia';

// Adminlar ro'yxati
const ADMIN_IDS = [6606638731, 901126203];

// Render.com muhit o'zgaruvchilari
const PORT = process.env.PORT || 10000;
const URL = process.env.RENDER_EXTERNAL_URL || process.env.URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'super_secret_token_123';

// MongoDB ulanish
mongoose.connect(MONGODB_URL)
    .then(() => console.log('✅ MongoDB ulandi'))
    .catch(err => console.error('❌ MongoDB xatosi:', err));

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
    date: { type: Date, default: Date.now }
});

// Kengaytirilgan subscription schema
const subscriptionSchema = new mongoose.Schema({
    title: { type: String, required: true },
    url: { type: String, required: true, unique: true },
    type: { 
        type: String, 
        enum: ['channel', 'group', 'private_channel', 'social', 'website'], 
        required: true 
    },
    icon: { type: String, default: '🔗' },
    order: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);
const Movie = mongoose.model('Movie', movieSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);

// Bot yaratish
const bot = new Telegraf(BOT_TOKEN);
bot.use(session({ 
    defaultSession: () => ({
        addingMovie: false,
        movieData: null,
        waitingForCode: false,
        broadcasting: false,
        addingLink: null,
        deletingLink: null
    })
}));

// Admin tekshirish
function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

// Iconlar ro'yxati
const TYPE_ICONS = {
    channel: '📢',
    group: '👥',
    private_channel: '🔒',
    social: '🌐',
    website: '🌍'
};

// Telegram username chiqarish (t.me/... dan)
function extractTelegramUsername(url) {
    try {
        // t.me/username format
        if (url.includes('t.me/')) {
            const match = url.match(/t\.me\/([^/?]+)/);
            if (match) {
                const username = match[1];
                // +invitehash format bo'lsa
                if (username.startsWith('+')) {
                    return null; // Maxfiy kanal, tekshirish kerak emas
                }
                return username;
            }
        }
        // https://t.me/username format
        if (url.includes('https://t.me/')) {
            const match = url.match(/https:\/\/t\.me\/([^/?]+)/);
            if (match) {
                const username = match[1];
                if (username.startsWith('+')) {
                    return null; // Maxfiy kanal
                }
                return username;
            }
        }
        // @username format
        if (url.includes('@')) {
            return url.replace('@', '');
        }
        return null;
    } catch (error) {
        return null;
    }
}

// Obuna tekshirish (faqat public kanallar va guruhlar uchun)
async function checkRequiredSubscriptions(userId) {
    if (isAdmin(userId)) return true;

    try {
        // Faqat channel va group tiplari uchun tekshirish
        const requiredSubs = await Subscription.find({
            type: { $in: ['channel', 'group'] }
        });
        
        if (requiredSubs.length === 0) return true;

        for (const sub of requiredSubs) {
            const username = extractTelegramUsername(sub.url);
            
            // Agar username chiqmasa (maxfiy kanal bo'lsa) o'tkazib yuboramiz
            if (!username) continue;
            
            try {
                // console.log(`Tekshirilmoqda: @${username}, User: ${userId}`);
                const member = await bot.telegram.getChatMember(`@${username}`, userId);
                const status = member.status;
                
                if (status === 'left' || status === 'kicked') {
                    // console.log(`❌ User ${userId} kanal @${username} da a'zo emas`);
                    return false;
                }
                // console.log(`✅ User ${userId} kanal @${username} da a'zo`);
            } catch (error) {
                console.error(`❌ Obuna tekshirish xatosi (@${username}):`, error.message);
                // Agar kanal topilmasa yoki bot admin bo'lmasa
                if (error.description && error.description.includes('chat not found')) {
                    console.log(`⚠️ @${username} kanali topilmadi, tekshirishdan o'tkazib yuborildi`);
                    continue;
                }
                // Bot admin bo'lmasa ham o'tkazib yuboramiz
                if (error.description && error.description.includes('bot is not a member')) {
                    console.log(`⚠️ Bot @${username} kanalida a'zo emas, tekshirishdan o'tkazib yuborildi`);
                    continue;
                }
                return false;
            }
        }
        return true;
    } catch (error) {
        console.error('❌ Obunalar xatosi:', error);
        return false;
    }
}

// Barcha havolalar uchun klaviatura
async function getLinksKeyboard() {
    const subs = await Subscription.find().sort('order');
    
    const rows = subs.map(sub => {
        const icon = TYPE_ICONS[sub.type] || sub.icon;
        return [Markup.button.url(`${icon} ${sub.title}`, sub.url)];
    });
    
    rows.push([Markup.button.callback('✅ Obunalarni tekshirish', 'check_subscription')]);
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
        console.error('❌ User qo\'shish xatosi:', error);
    }
}

// ====================== ASOSIY HANDLERLAR ======================

// START HANDLER
bot.start(async (ctx) => {
    console.log(`🚀 Start bosildi: ${ctx.from.id} - @${ctx.from.username}`);
    await addUser(ctx);
    const userId = ctx.from.id;
    const isSubscribed = await checkRequiredSubscriptions(userId);

    if (!isSubscribed && !isAdmin(userId)) {
        const keyboard = await getLinksKeyboard();
        return ctx.reply(
            '🎬 *Kino Botiga xush kelibsiz!*\n\n' +
            'Botdan to\'liq foydalanish uchun quyidagi kanal va guruhlarga obuna bo\'ling:\n\n' +
            '1️⃣ Kanal/guruhga kirish uchun tugmani bosing\n' +
            '2️⃣ Obuna bo\'ling\n' +
            '3️⃣ *"✅ Obunalarni tekshirish"* tugmasini bosing\n\n' +
            '⚠️ *Eslatma:* Faqat obuna bo\'lish yetarli emas, tekshirish tugmasini ham bosing!',
            { 
                parse_mode: 'Markdown',
                ...keyboard 
            }
        );
    }

    if (isAdmin(userId)) {
        const adminKeyboard = Markup.keyboard([
            ['🎬 Kino qoʻshish', '📊 Statistika'],
            ['📢 Broadcast', '🔗 Havola qoʻshish'],
            ['📋 Havolalar roʻyxati', '➖ Havola oʻchirish'],
            ['🏠 Bosh menyu']
        ]).resize().oneTime();
        return ctx.reply('👨‍💻 *Admin panelga xush kelibsiz!*', { 
            parse_mode: 'Markdown',
            ...adminKeyboard 
        });
    }

    ctx.reply(
        '🎥 *Botga xush kelibsiz!*\n\n' +
        'Kino olish uchun kod yuboring (masalan: 7)\n' +
        '⚠️ *Diqqat:* Bot 18+ kontent uchun mo\'ljallangan!\n\n' +
        '📌 *Foydali havolalar:*',
        {
            parse_mode: 'Markdown',
            ...(await getLinksKeyboard())
        }
    );
});

// Obuna tekshirish
bot.action('check_subscription', async (ctx) => {
    await ctx.answerCbQuery();
    console.log(`🔍 Obuna tekshirildi: ${ctx.from.id}`);
    const userId = ctx.from.id;
    const isSubscribed = await checkRequiredSubscriptions(userId);

    if (isSubscribed || isAdmin(userId)) {
        await addUser(ctx);
        if (isAdmin(userId)) {
            const adminKeyboard = Markup.keyboard([
                ['🎬 Kino qoʻshish', '📊 Statistika'],
                ['📢 Broadcast', '🔗 Havola qoʻshish'],
                ['📋 Havolalar roʻyxati', '➖ Havola oʻchirish'],
                ['🏠 Bosh menyu']
            ]).resize().oneTime();
            return ctx.reply('✅ *Obuna tasdiqlandi!*\nAdmin panelga xush kelibsiz!', { 
                parse_mode: 'Markdown',
                ...adminKeyboard 
            });
        }
        return ctx.reply('✅ *Obuna tasdiqlandi!*\n\nKino olish uchun kod yuboring.', {
            parse_mode: 'Markdown'
        });
    }

    const keyboard = await getLinksKeyboard();
    ctx.reply('❌ *Hali barcha majburiy kanal va guruhlarga obuna bo\'lmagansiz:*', {
        parse_mode: 'Markdown',
        ...keyboard
    });
});

// ====================== ADMIN FUNKSIYALARI ======================

// Kino qo'shish
bot.hears('🎬 Kino qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    ctx.session.addingMovie = true;
    ctx.reply(
        '🎬 *Kino qoʻshish rejimi yoqildi!*\n\n' +
        'Endi video yuboring yoki forward qiling.\n' +
        'Videoga izoh qo\'shishingiz mumkin (masalan: kino nomi).\n' +
        'Keyin sizdan kino kodi so\'raladi.',
        { parse_mode: 'Markdown' }
    );
});

// Video qabul qilish
bot.on('video', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    if (!ctx.session.addingMovie) return;

    ctx.session.movieData = {
        file_id: ctx.message.video.file_id,
        caption: ctx.message.caption || ''
    };
    ctx.session.waitingForCode = true;
    
    ctx.reply('✅ *Video qabul qilindi!*\nEndi kino kodi yuboring (masalan: 123):', { 
        parse_mode: 'Markdown' 
    });
});

// Statistika
bot.hears('📊 Statistika', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    try {
        const users = await User.countDocuments();
        const movies = await Movie.countDocuments();
        const subs = await Subscription.countDocuments();
        
        const channelSubs = await Subscription.countDocuments({ type: 'channel' });
        const groupSubs = await Subscription.countDocuments({ type: 'group' });
        const privateSubs = await Subscription.countDocuments({ type: 'private_channel' });
        const otherSubs = subs - channelSubs - groupSubs - privateSubs;
        
        ctx.reply(
            `📊 *Bot statistikasi:*\n\n` +
            `👥 Foydalanuvchilar: ${users}\n` +
            `🎬 Kinolar soni: ${movies}\n` +
            `🔗 Jami havolalar: ${subs}\n` +
            `   ├ Kanal: ${channelSubs}\n` +
            `   ├ Guruh: ${groupSubs}\n` +
            `   ├ Maxfiy kanal: ${privateSubs}\n` +
            `   └ Boshqa: ${otherSubs}`,
            { parse_mode: 'Markdown' }
        );
    } catch (err) {
        ctx.reply('❌ Statistika olishda xatolik');
    }
});

// Broadcast
bot.hears('📢 Broadcast', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    ctx.session.broadcasting = true;
    ctx.reply(
        '📢 *Broadcast rejimi yoqildi!*\n\n' +
        'Barcha foydalanuvchilarga yubormoqchi bo\'lgan xabaringizni yuboring:\n' +
        'Matn, rasm, video, audio, dokument yoki boshqa kontent.',
        { parse_mode: 'Markdown' }
    );
});

// Havola qo'shish boshlash
bot.hears('🔗 Havola qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    const typeKeyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('📢 Oddiy kanal', 'add_link_channel'),
            Markup.button.callback('🔒 Maxfiy kanal', 'add_link_private_channel')
        ],
        [
            Markup.button.callback('👥 Guruh', 'add_link_group'),
            Markup.button.callback('🌐 Ijtimoiy tarmoq', 'add_link_social')
        ],
        [
            Markup.button.callback('🌍 Website', 'add_link_website')
        ]
    ]);
    
    ctx.reply('Qanday turdagi havola qo\'shmoqchisiz?', typeKeyboard);
});

// Havola turini tanlash
bot.action(/add_link_(.+)/, (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    const type = ctx.match[1];
    const typeNames = {
        'channel': '📢 Oddiy kanal',
        'private_channel': '🔒 Maxfiy kanal',
        'group': '👥 Guruh',
        'social': '🌐 Ijtimoiy tarmoq',
        'website': '🌍 Website'
    };
    
    ctx.session.addingLink = {
        type: type,
        step: 'title'
    };
    
    ctx.reply(`*${typeNames[type]} qo'shish*\n\nHavola uchun nom yozing (masalan: "Kino Janri"):`, {
        parse_mode: 'Markdown'
    });
});

// Havolalar ro'yxatini ko'rish
bot.hears('📋 Havolalar roʻyxati', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    try {
        const subs = await Subscription.find().sort('order');
        
        if (subs.length === 0) {
            return ctx.reply('❌ Hozircha hech qanday havola mavjud emas.');
        }
        
        let message = '📋 *Barcha havolalar:*\n\n';
        
        subs.forEach((sub, index) => {
            const typeNames = {
                'channel': 'Kanal',
                'private_channel': 'Maxfiy kanal',
                'group': 'Guruh',
                'social': 'Ijtimoiy tarmoq',
                'website': 'Website'
            };
            
            message += `${index + 1}. *${sub.title}*\n`;
            message += `   🔗 ${sub.url}\n`;
            message += `   📝 Turi: ${typeNames[sub.type]}\n`;
            message += `   ⚙️ ID: \`${sub._id}\`\n\n`;
        });
        
        ctx.reply(message, { 
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🗑️ Havola o\'chirish', 'delete_link_prompt')]
            ])
        });
    } catch (error) {
        ctx.reply('❌ Xatolik yuz berdi: ' + error.message);
    }
});

// Havola o'chirish prompt
bot.action('delete_link_prompt', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    ctx.reply('O\'chirish uchun havola ID sini yuboring (yuqoridagi ro\'yxatdan):\n\nNamuna: `658f1a2b3c4d5e6f78901234`');
});

// Havola o'chirishni tasdiqlash
bot.action('confirm_delete_link', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    
    if (!ctx.session.deletingLink) {
        return ctx.reply('❌ Sessiya muddati tugagan.');
    }
    
    const result = await Subscription.deleteOne({ _id: ctx.session.deletingLink.id });
    
    if (result.deletedCount > 0) {
        ctx.reply(`✅ *${ctx.session.deletingLink.title}* havolasi muvaffaqiyatli o'chirildi.`, {
            parse_mode: 'Markdown'
        });
    } else {
        ctx.reply('❌ Havola o\'chirilmadi.');
    }
    
    delete ctx.session.deletingLink;
});

bot.action('cancel_delete_link', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ctx.answerCbQuery();
    delete ctx.session.deletingLink;
    ctx.reply('❌ Havola o\'chirish bekor qilindi.');
});

// Bosh menyu
bot.hears('🏠 Bosh menyu', async (ctx) => {
    await addUser(ctx);
    const userId = ctx.from.id;
    
    if (isAdmin(userId)) {
        const adminKeyboard = Markup.keyboard([
            ['🎬 Kino qoʻshish', '📊 Statistika'],
            ['📢 Broadcast', '🔗 Havola qoʻshish'],
            ['📋 Havolalar roʻyxati', '➖ Havola oʻchirish'],
            ['🏠 Bosh menyu']
        ]).resize().oneTime();
        return ctx.reply('🏠 *Bosh menyuga xush kelibsiz!*', { 
            parse_mode: 'Markdown',
            ...adminKeyboard 
        });
    }
    
    ctx.reply(
        '🎥 *Bosh menyu*\n\nKino olish uchun kod yuboring (masalan: 7)\n' +
        '⚠️ *Diqqat:* Bot 18+ kontent uchun mo\'ljallangan!\n\n' +
        '📌 *Foydali havolalar:*',
        {
            parse_mode: 'Markdown',
            ...(await getLinksKeyboard())
        }
    );
});

// ====================== ASOSIY TEXT HANDLER ======================

bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;

    // Havola qo'shish jarayoni
    if (isAdmin(userId) && ctx.session.addingLink) {
        const step = ctx.session.addingLink.step;
        
        if (step === 'title') {
            ctx.session.addingLink.title = text;
            ctx.session.addingLink.step = 'url';
            
            return ctx.reply('Endi havola linkini yuboring:');
        }
        
        if (step === 'url') {
            const { title, type } = ctx.session.addingLink;
            
            // URL tekshirish
            if (!text.startsWith('http://') && !text.startsWith('https://') && !text.startsWith('t.me/')) {
                return ctx.reply('❌ Noto\'g\'ri havola formati. http://, https:// yoki t.me/ bilan boshlansin.');
            }
            
            // To'liq URL yaratish
            let url = text;
            if (text.startsWith('t.me/')) {
                url = `https://${text}`;
            }
            
            try {
                // Order ni aniqlash
                const count = await Subscription.countDocuments({ type });
                const order = count + 1;
                
                await Subscription.create({
                    title: title,
                    url: url,
                    type: type,
                    icon: TYPE_ICONS[type],
                    order: order
                });
                
                delete ctx.session.addingLink;
                
                return ctx.reply(`✅ *${title}* havolasi muvaffaqiyatli qo'shildi!`, {
                    parse_mode: 'Markdown'
                });
            } catch (err) {
                if (err.code === 11000) {
                    return ctx.reply('❌ Bu havola allaqachon mavjud.');
                }
                return ctx.reply('❌ Xatolik yuz berdi: ' + err.message);
            }
        }
    }

    // Havola o'chirish (ID orqali)
    if (isAdmin(userId) && text.length === 24) { // MongoDB ObjectId uzunligi
        try {
            const sub = await Subscription.findById(text);
            if (!sub) {
                return ctx.reply('❌ Bunday ID bilan havola topilmadi.');
            }
            
            ctx.session.deletingLink = {
                id: text,
                title: sub.title
            };
            
            return ctx.reply(`🗑️ *${sub.title}* havolasini o'chirishni tasdiqlaysizmi?`, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback('✅ Ha', 'confirm_delete_link'),
                        Markup.button.callback('❌ Yo\'q', 'cancel_delete_link')
                    ]
                ])
            });
        } catch (error) {
            return ctx.reply('❌ Noto\'g\'ri ID formati.');
        }
    }

    // Havola o'chirish (eski usul)
    if (isAdmin(userId) && text === '➖ Havola oʻchirish') {
        return ctx.reply('Havola ID sini yuboring yoki "📋 Havolalar roʻyxati" tugmasini bosing.');
    }

    // Kino kodi qabul qilish
    if (isAdmin(userId) && ctx.session.waitingForCode && ctx.session.movieData) {
        const code = text;
        
        if (!/^\d+$/.test(code)) {
            return ctx.reply('❌ Kod faqat raqamlardan iborat bo\'lishi kerak. Qayta kiriting:');
        }

        try {
            const existing = await Movie.findOne({ code });
            if (existing) {
                return ctx.reply(`⚠️ ${code} kodi allaqachon mavjud. Boshqa kod kiriting:`, {
                    parse_mode: 'Markdown'
                });
            }

            await Movie.create({
                code,
                file_id: ctx.session.movieData.file_id,
                caption: ctx.session.movieData.caption || `Kino kodi: ${code}`
            });

            ctx.session.addingMovie = false;
            ctx.session.waitingForCode = false;
            delete ctx.session.movieData;

            return ctx.reply(`✅ *${code} kodli kino muvaffaqiyatli saqlandi!*`, {
                parse_mode: 'Markdown'
            });
        } catch (err) {
            console.error('❌ Kino saqlash xatosi:', err);
            return ctx.reply('❌ Saqlashda xatolik yuz berdi. Qayta urinib ko\'ring.', {
                parse_mode: 'Markdown'
            });
        }
    }

    // Broadcast qilish
    if (isAdmin(userId) && ctx.session.broadcasting) {
        try {
            const users = await User.find({});
            let success = 0;
            let failed = 0;
            
            for (const user of users) {
                try {
                    await ctx.telegram.copyMessage(user.user_id, ctx.chat.id, ctx.message.message_id);
                    success++;
                    
                    // Har 50ta xabardan keyin biroz kutamiz
                    if (success % 50 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                } catch (e) {
                    failed++;
                }
            }
            
            ctx.session.broadcasting = false;
            return ctx.reply(
                `✅ *Broadcast yakunlandi!*\n` +
                `📤 Yuborildi: ${success} ta\n` +
                `❌ Yuborilmadi: ${failed} ta`,
                { parse_mode: 'Markdown' }
            );
        } catch (err) {
            ctx.session.broadcasting = false;
            return ctx.reply('❌ Broadcastda xatolik yuz berdi.', { parse_mode: 'Markdown' });
        }
    }

    // Foydalanuvchi uchun kino qidirish
    const isSubscribed = await checkRequiredSubscriptions(userId);
    if (!isSubscribed && !isAdmin(userId)) {
        const keyboard = await getLinksKeyboard();
        return ctx.reply('❌ *Avval barcha majburiy kanal va guruhlarga obuna boʻling:*', { 
            parse_mode: 'Markdown',
            ...keyboard 
        });
    }

    // Kino kodini qidirish (faqat raqamlar)
    if (/^\d+$/.test(text)) {
        await addUser(ctx);
        const movie = await Movie.findOne({ code: text });
        
        if (!movie) {
            return ctx.reply(
                '❌ *Bunday kodda kino topilmadi.*\n\n' +
                '📌 *Foydali havolalar:*',
                {
                    parse_mode: 'Markdown',
                    ...(await getLinksKeyboard())
                }
            );
        }

        try {
            await ctx.replyWithVideo(movie.file_id, {
                caption: movie.caption || `🎬 *Kino kodi:* ${movie.code}\n\n👉 Boshqa kodlar bilan kinolar toping!`,
                parse_mode: 'Markdown'
            });
        } catch (err) {
            console.error('❌ Video yuborish xatosi:', err);
            ctx.reply('❌ *Video yuborishda xatolik yuz berdi. Adminlarga murojaat qiling.*', { 
                parse_mode: 'Markdown' 
            });
        }
    } else {
        // Agar raqam bo'lmasa, oddiy matn
        if (!isAdmin(userId)) {
            ctx.reply('⚠️ *Iltimos, faqat raqamlardan iborat kino kodini yuboring.*\n\n📌 *Foydali havolalar:*', {
                parse_mode: 'Markdown',
                ...(await getLinksKeyboard())
            });
        }
    }
});

// Boshqa kontentlar uchun broadcast
bot.on(['photo', 'document', 'audio', 'voice', 'animation'], async (ctx) => {
    if (!isAdmin(ctx.from.id) || !ctx.session.broadcasting) return;

    try {
        const users = await User.find({});
        let success = 0;
        
        for (const user of users) {
            try {
                await ctx.telegram.copyMessage(user.user_id, ctx.chat.id, ctx.message.message_id);
                success++;
                
                if (success % 50 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (e) {
                // O'tkazib yuborish
            }
        }
        
        ctx.session.broadcasting = false;
        ctx.reply(`✅ *Broadcast ${success} ta foydalanuvchiga yuborildi.*`, { 
            parse_mode: 'Markdown' 
        });
    } catch (err) {
        ctx.session.broadcasting = false;
        ctx.reply('❌ *Broadcastda xatolik yuz berdi.*', { 
            parse_mode: 'Markdown' 
        });
    }
});

// ====================== WEBHOOK SOZLASH ======================

if (URL) {
    console.log('🚀 Webhook rejimida ishga tushyapman...');
    
    // Webhook path yaratish
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    const fullUrl = `${URL}${webhookPath}`;
    
    console.log(`📡 Webhook manzili: ${fullUrl}`);

    // Express server yaratish
    const app = express();
    app.use(express.json());

    // Asosiy sahifa
    app.get('/', (req, res) => {
        res.send('🎬 Kino Bot ishlamoqda! 🚀');
    });

    // Webhook endpoint
    app.post(webhookPath, (req, res) => {
        // Secret token tekshirish
        const token = req.headers['x-telegram-bot-api-secret-token'];
        if (token !== WEBHOOK_SECRET) {
            console.warn('⚠️ Noto\'g\'ri secret token');
            return res.status(403).send('Forbidden');
        }
        
        // Telegraf webhook middleware ni ishlatish
        return bot.handleUpdate(req.body, res).then(() => {
            res.status(200).end();
        }).catch(err => {
            console.error('❌ Webhook xatosi:', err);
            res.status(500).end();
        });
    });

    // Serverni ishga tushirish
    const server = app.listen(PORT, async () => {
        console.log(`✅ Server ${PORT} portda ishga tushdi`);
        
        // Webhook o'rnatish
        try {
            await bot.telegram.setWebhook(fullUrl, {
                secret_token: WEBHOOK_SECRET,
                drop_pending_updates: true
            });
            console.log(`✅ Webhook muvaffaqiyatli o'rnatildi: ${fullUrl}`);
            console.log('🤖 Bot to\'liq ishga tushdi va webhook rejimida ishlamoqda!');
        } catch (err) {
            console.error('❌ Webhook o\'rnatishda xato:', err.message);
        }
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('🛑 SIGTERM signal qabul qilindi, server yopilmoqda...');
        server.close(() => {
            console.log('✅ Server yopildi');
            process.exit(0);
        });
    });

} else {
    console.log('🚀 Local polling rejimida ishga tushyapman...');
    
    // Local test uchun polling
    bot.launch()
        .then(() => console.log('✅ Bot polling rejimida ishga tushdi'))
        .catch(err => console.error('❌ Xatolik:', err));

    // Faqat polling rejimida graceful stop ni o'rnatamiz
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

console.log('🚀 Bot mukammal ishlashga tayyor!');
