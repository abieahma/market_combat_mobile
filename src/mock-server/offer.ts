// Offer for game authors. DRAFT: the text below is a placeholder and must be
// checked by a lawyer before the platform opens to authors. Each new version
// gets a new `version`; a proposal records which one its author accepted.

import type { Offer } from '../api/contract';

export const OFFER_VERSION = '2026-10-13-draft';

const TEXT: Record<'en' | 'ru', { title: string; paragraphs: string[] }> = {
  en: {
    title: 'Offer for game authors (draft)',
    paragraphs: [
      'This draft has not yet been checked by a lawyer and may change before the platform opens to authors.',
      '1. You send the idea of a game, not code. The Market Combat platform decides whether to build it, builds it itself and runs it.',
      '2. The game must follow the rules of the platform and belong to its theme: the war of the markets and the universes of Waldberik, Ozonik, Avitos and Yandos (one, several or all of them).',
      '3. The game must not break the law of the countries where the platform works or the rules of the app stores. No gambling for real money outside the ABIE rules of the platform, no violence beyond a stylised fight, no content for adults only.',
      '4. You confirm that the idea is yours and does not use other people\'s brands, characters or works without permission.',
      '5. The platform may ask for changes, reject the proposal, or remove a published game if it breaks these terms, the law or store rules.',
      '6. The universes, the game currency and its rate to ABIE, the entry price and your share are set once when the game is published and never change afterwards.',
      '7. Your income: your share of every purchase of the game\'s currency, and, for a paid game, every entry minus 10% kept by the platform. Income is paid to your ABIE account on the platform.',
      '8. A general exchange of game currencies back to ABIE does not exist yet.',
      '9. The platform may update this offer; a new version applies to proposals sent after it is published.',
    ],
  },
  ru: {
    title: 'Оферта для авторов игр (черновик)',
    paragraphs: [
      'Это черновик. Текст ещё не проверен юристом и может измениться до того, как платформа откроется для авторов.',
      '1. Вы присылаете идею игры, а не код. Платформа Market Combat сама решает, делать ли игру, сама её разрабатывает и запускает.',
      '2. Игра соответствует правилам платформы и её теме: война маркетов и вселенные Валдберика, Озоника, Авитоса и Яндоса (одна, несколько или все).',
      '3. Игра не нарушает законы стран, где работает платформа, и правила магазинов приложений. Никаких азартных игр на реальные деньги вне правил ABIE платформы, никакого насилия сверх условного поединка, никакого контента только для взрослых.',
      '4. Вы подтверждаете, что идея принадлежит вам и не использует чужие бренды, персонажей или произведения без разрешения.',
      '5. Платформа вправе попросить правки, отклонить заявку или снять опубликованную игру, если она нарушает эти условия, закон или правила магазинов.',
      '6. Вселенные, валюта игры и её курс к ABIE, цена входа и ваша доля задаются один раз при публикации игры и потом не меняются.',
      '7. Ваш доход: ваша доля с каждой покупки валюты игры и, если вход платный, каждая оплата входа минус 10%, которые оставляет себе платформа. Доход поступает на ваш счёт ABIE на платформе.',
      '8. Общего обмена валют игр обратно на ABIE пока нет.',
      '9. Платформа может обновлять оферту; новая версия действует для заявок, поданных после её публикации.',
    ],
  },
};

export function offerFor(lang: string): Offer {
  // Until the lawyer has checked it, the text exists in English and Russian; CIS languages get Russian.
  const t = TEXT[lang === 'en' ? 'en' : 'ru'];
  return { version: OFFER_VERSION, draft: true, title: t.title, paragraphs: t.paragraphs };
}
