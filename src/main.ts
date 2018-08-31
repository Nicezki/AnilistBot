import { config } from 'dotenv';
import { connect, set } from 'mongoose';
import { join } from 'path';
import Telegraf from 'telegraf';
import I18n from 'telegraf-i18n';
import RedisSession from 'telegraf-session-redis';
import { allSearch } from './lib/anilist/searches/searches';
import { AllRequests, IBotContext, RequestsFiled } from './lib/telegram';
import { callbackKeyboard, handleCallback } from './lib/telegram/callback';
import { toInlineArticle } from './lib/telegram/inline';
import { menuKeyboard } from './lib/telegram/keyboard';
import { isEditable } from './lib/telegram/utils/edit';
import { fetchPage, sanitize } from './lib/telegram/utils/parse';
import { getSessionKey } from './lib/telegram/utils/redis';

config();

const bot = new Telegraf(process.env.BOT_KEY);
const internationalization = new I18n({
    useSession: true,
    allowMissing: true,
    defaultLanguage: 'en',
    sessionName: 'session',
    directory: join(__dirname, '../others/locales')
});
const redisStorage = new RedisSession({
    getSessionKey,
    property: 'redis',
    store: {
        host: process.env.TELEGRAM_SESSION_HOST,
        port: process.env.TELEGRAM_SESSION_PORT
    }
});

let dbStatus = false;

connect(process.env.MONGODB_URI).then(() => {
    // https://stackoverflow.com/a/51918795/7092954
    set('useCreateIndex', true);
    set('useFindAndModify', false);

    console.log('DB connected.');

    dbStatus = true;
}).catch(err => {
    console.error(err);

    dbStatus = false;
});

bot.startPolling();

bot.use(Telegraf.log());
bot.use(redisStorage.middleware());
bot.use(internationalization.middleware());

bot.catch(console.error);

bot.start(async ({ i18n, replyWithMarkdown }: IBotContext) => replyWithMarkdown(i18n.t('start')));

bot.on('inline_query', async ({ i18n, answerInlineQuery, inlineQuery, redis }: IBotContext) => {
    const perPage = 20;
    const page = fetchPage(inlineQuery.offset);
    const next_offset = (page + perPage).toString();
    const search = sanitize({ message: inlineQuery.query });
    const results = await allSearch({ translation: i18n, search, page, perPage }).then(toInlineArticle);

    return answerInlineQuery(results, { next_offset });
});

bot.on('callback_query', async ({ i18n, callbackQuery, editMessageText, answerCbQuery, redis }: IBotContext) => {
    const data = callbackQuery.data.split('/');
    const id = parseInt(data[2], 10);
    const field = <RequestsFiled> data[0];
    const request = <AllRequests> data[1];
    const response = await handleCallback({ translation: i18n, id, request, field, dbStatus });

    if (isEditable(field)) {
        await answerCbQuery(i18n.t('loading'));

        return editMessageText(response, {
            parse_mode: 'Markdown',
            reply_markup: callbackKeyboard({ translation: i18n, request })
        });
    }

    return answerCbQuery(response, true);
});

bot.on('text', async ({ i18n, message, replyWithMarkdown, redis }: IBotContext) => {
    const { text } = message;
    const { type } = message.chat;

    if ('private' !== type) {
        return false;
    } if (i18n.t('menu') === text.toLowerCase()) {
        await replyWithMarkdown(i18n.t('menuGreetings'));

        return replyWithMarkdown(i18n.t('menuOptions'), { reply_markup: menuKeyboard({ translation: i18n }) });
    } if (i18n.t('help') === text.toLowerCase()) {
        return replyWithMarkdown(i18n.t('helpOptions'));
    }

    return i18n.t('notAvailable');
});
