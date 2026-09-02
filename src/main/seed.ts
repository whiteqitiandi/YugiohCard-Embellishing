import type { CatalogCard } from '../shared/catalog'

type SeedInput = Omit<
  CatalogCard,
  'konamiId' | 'rank' | 'linkRating' | 'linkArrows' | 'spellTrapIcon' |
  'pendulumScaleLeft' | 'pendulumScaleRight' | 'pendulumText' | 'effectTags' |
  'relations' | 'compatibility' | 'artworks' | 'ruleTexts' | 'isUnpopular'
> & Partial<Pick<
  CatalogCard,
  'konamiId' | 'rank' | 'linkRating' | 'linkArrows' | 'spellTrapIcon' |
  'pendulumScaleLeft' | 'pendulumScaleRight' | 'pendulumText' | 'effectTags' | 'relations'
>> & {
  ruleText: string
  note?: string
}

const frameLabels: Record<CatalogCard['frame'], string> = {
  normal: '通常怪獸',
  effect: '效果怪獸',
  ritual: '儀式怪獸',
  fusion: '融合怪獸',
  synchro: '同步怪獸',
  xyz: '超量怪獸',
  link: '連結怪獸',
  spell: '魔法卡',
  trap: '陷阱卡'
}

const makeCard = (input: SeedInput): CatalogCard => {
  const imagePasscode = String(Number(input.passcode))
  const pendulum = input.pendulumScaleLeft != null || input.pendulumScaleRight != null
  const category = `${pendulum ? '鐘擺／' : ''}${frameLabels[input.frame]}`

  return {
    ...input,
    konamiId: input.konamiId ?? null,
    rank: input.rank ?? null,
    linkRating: input.linkRating ?? null,
    linkArrows: input.linkArrows ?? [],
    spellTrapIcon: input.spellTrapIcon ?? null,
    pendulumScaleLeft: input.pendulumScaleLeft ?? null,
    pendulumScaleRight: input.pendulumScaleRight ?? null,
    pendulumText: input.pendulumText ?? null,
    isUnpopular: false,
    effectTags: input.effectTags ?? [category],
    relations: input.relations ?? [],
    compatibility: [
      { key: `frame-${input.frame}`, label: category, weight: 1 },
      { key: `attribute-${input.attribute}`, label: `${input.attribute}屬性`, weight: 0.9 }
    ],
    artworks: [{
      id: `${input.id}-art`,
      variantLabel: '標準構圖',
      sourceUrl: `https://images.ygoprodeck.com/images/cards_cropped/${imagePasscode}.jpg`,
      sourceName: 'YGOPRODeck',
      shardKey: 'classification-examples'
    }],
    ruleTexts: [{
      ruleset: 'ocg-master',
      label: 'OCG／Master Rule',
      textZh: input.ruleText,
      note: input.note ?? '示範用繁中摘要；正式資料應以官方最新卡片文字為準。'
    }]
  }
}

export const seedCards: CatalogCard[] = [
  makeCard({
    id: 'blue-eyes-white-dragon', passcode: '89631139', nameZh: '青眼白龍',
    nameJa: '青眼の白龍', nameEn: 'Blue-Eyes White Dragon', kind: 'monster', frame: 'normal',
    attribute: '光', race: '龍族', typeLine: '龍族／通常', level: 8, atk: 3000, def: 2500,
    ruleText: '以高攻擊力著稱的傳說之龍。擁有足以粉碎一切對手的破壞力。',
    effectTags: ['通常怪獸', '高攻擊力'], relations: ['青眼'], accent: '#6f9ce7'
  }),
  makeCard({
    id: 'dark-magician', passcode: '46986414', nameZh: '黑魔導',
    nameJa: 'ブラック・マジシャン', nameEn: 'Dark Magician', kind: 'monster', frame: 'normal',
    attribute: '闇', race: '魔法使族', typeLine: '魔法使族／通常', level: 7, atk: 2500, def: 2100,
    ruleText: '在攻擊力與守備力方面都是最高級別的魔法師。',
    effectTags: ['通常怪獸'], relations: ['黑魔導'], accent: '#8657c9'
  }),
  makeCard({
    id: 'effect-veiler', passcode: '97268402', nameZh: '效果分隔士',
    nameJa: 'エフェクト・ヴェーラー', nameEn: 'Effect Veiler', kind: 'monster', frame: 'effect',
    attribute: '光', race: '魔法使族', typeLine: '魔法使族／協調／效果', level: 1, atk: 0, def: 0,
    ruleText: '對方主要階段，把此卡從手牌送入墓地，以對方場上1隻效果怪獸為對象才能發動。直到回合結束時，那隻怪獸的效果無效。',
    effectTags: ['協調', '效果無效', '手牌誘發'], accent: '#8ab7bd'
  }),
  makeCard({
    id: 'nekroz-of-trishula', passcode: '52068432', nameZh: '影靈衣的三叉戟',
    nameJa: 'トリシューラの影霊衣', nameEn: 'Nekroz of Trishula', kind: 'monster', frame: 'ritual',
    attribute: '水', race: '戰士族', typeLine: '戰士族／儀式／效果', level: 9, atk: 2700, def: 2000,
    ruleText: '藉由「影靈衣」儀式魔法卡降臨。此卡只能以等級9以外的怪獸來儀式召喚。對方場上有從額外牌組特殊召喚的怪獸存在時，從手牌捨棄此卡才能發動：那隻怪獸的效果無效。',
    effectTags: ['儀式召喚', '效果無效'], relations: ['影靈衣'], accent: '#4d94d8'
  }),
  makeCard({
    id: 'elemental-hero-nova-master', passcode: '01945387', nameZh: 'E・HERO 新星大師',
    nameJa: 'E・HERO ノヴァマスター', nameEn: 'Elemental HERO Nova Master', kind: 'monster', frame: 'fusion',
    attribute: '炎', race: '戰士族', typeLine: '戰士族／融合／效果', level: 8, atk: 2600, def: 2100,
    ruleText: '「E・HERO」怪獸＋炎屬性怪獸。此卡以戰鬥破壞對方怪獸的場合發動：自己抽1張牌。',
    effectTags: ['融合召喚', '抽牌'], relations: ['E・HERO'], accent: '#d96b42'
  }),
  makeCard({
    id: 'naturia-beast', passcode: '33198837', nameZh: '自然獸',
    nameJa: 'ナチュル・ビースト', nameEn: 'Naturia Beast', kind: 'monster', frame: 'synchro',
    attribute: '地', race: '獸族', typeLine: '獸族／同步／效果', level: 5, atk: 2200, def: 1700,
    ruleText: '地屬性協調＋協調以外的地屬性怪獸1隻以上。魔法卡發動時，從自己牌組上方把2張卡送入墓地才能發動：那個發動無效並破壞。',
    effectTags: ['同步召喚', '魔法無效'], relations: ['自然'], accent: '#85a45d'
  }),
  makeCard({
    id: 'stardust-dragon', passcode: '44508094', nameZh: '星塵龍',
    nameJa: 'スターダスト・ドラゴン', nameEn: 'Stardust Dragon', kind: 'monster', frame: 'synchro',
    attribute: '風', race: '龍族', typeLine: '龍族／同步／效果', level: 8, atk: 2500, def: 2000,
    ruleText: '協調＋協調以外的怪獸1隻以上。包含「破壞場上的卡」效果的魔法、陷阱或怪獸效果發動時，解放此卡才能發動：那個發動無效並破壞。',
    effectTags: ['同步召喚', '破壞無效'], relations: ['星塵'], accent: '#91b9c6'
  }),
  makeCard({
    id: 'red-supernova-dragon', passcode: '99585850', nameZh: '赤紅超新星龍',
    nameJa: 'スカーレッド・スーパーノヴァ・ドラゴン', nameEn: 'Red Supernova Dragon', kind: 'monster', frame: 'synchro',
    attribute: '闇', race: '龍族', typeLine: '龍族／同步／效果', level: 12, atk: 4000, def: 3000,
    ruleText: '協調3隻＋協調以外的同步怪獸1隻以上\n此卡從額外牌組僅能以同步召喚特殊召喚。①：此卡的攻擊力上升自己墓地的協調數量×500。②：場上的此卡不會因對方的效果被破壞。③：1回合1次，對方發動怪獸效果時，或對方怪獸攻擊宣言時可以發動。將此卡及對方場上的卡全部除外。④：此卡因③效果被除外的場合，在下個自己的結束階段發動。將除外狀態的此卡特殊召喚。',
    effectTags: ['同步召喚', '效果破壞耐性', '全場除外'], relations: ['紅龍大天使'], accent: '#9f2633',
    note: '完整效果依 Konami Neuron 官方卡片資料整理，用於長文本與捲軸測試。'
  }),
  makeCard({
    id: 'number-39-utopia', passcode: '84013237', nameZh: 'No.39 希望皇 霍普',
    nameJa: 'No.39 希望皇ホープ', nameEn: 'Number 39: Utopia', kind: 'monster', frame: 'xyz',
    attribute: '光', race: '戰士族', typeLine: '戰士族／超量／效果', level: null, rank: 4, atk: 2500, def: 2000,
    ruleText: '等級4怪獸×2。任一方怪獸攻擊宣言時，取除此卡1個超量素材才能發動：那次攻擊無效。此卡沒有超量素材的狀態被選為攻擊對象時，破壞此卡。',
    effectTags: ['超量召喚', '攻擊無效'], relations: ['No.'], accent: '#525865'
  }),
  makeCard({
    id: 'odd-eyes-pendulum-dragon', passcode: '16178681', nameZh: '異色眼鐘擺龍',
    nameJa: 'オッドアイズ・ペンデュラム・ドラゴン', nameEn: 'Odd-Eyes Pendulum Dragon', kind: 'monster', frame: 'effect',
    attribute: '闇', race: '龍族', typeLine: '龍族／鐘擺／效果', level: 7, atk: 2500, def: 2000,
    pendulumScaleLeft: 4, pendulumScaleRight: 4,
    pendulumText: '自己的鐘擺怪獸戰鬥給予對方的戰鬥傷害變成2倍。結束階段可以破壞此卡，從牌組把1隻攻擊力1500以下的鐘擺怪獸加入手牌。',
    ruleText: '此卡和對方怪獸進行戰鬥的傷害計算前才能發動：那隻對方怪獸的攻擊力直到結束階段變成原本的一半。',
    effectTags: ['鐘擺召喚', '戰鬥傷害'], relations: ['異色眼'], accent: '#b65869'
  }),
  makeCard({
    id: 'clear-wing-fast-dragon', passcode: '90036274', nameZh: '清透翼疾速龍',
    nameJa: 'クリアウィング・ファスト・ドラゴン', nameEn: 'Clear Wing Fast Dragon', kind: 'monster', frame: 'synchro',
    attribute: '風', race: '龍族', typeLine: '龍族／同步／鐘擺／效果', level: 7, atk: 2500, def: 2000,
    pendulumScaleLeft: 4, pendulumScaleRight: 4,
    pendulumText: '此卡名的鐘擺效果1回合僅可使用1次。①：為使合計等級為7，將自己場上1隻表側表示的「疾行機人」協調和1隻協調以外的怪獸送至墓地可以發動。將鐘擺區的此卡特殊召喚。',
    ruleText: '協調＋協調以外的風屬性怪獸1隻以上\n此卡名的①怪獸效果1回合僅可使用1次。①：以對方場上1隻從額外牌組特殊召喚的表側表示怪獸為對象可以發動。直到回合結束時，該怪獸的攻擊力變成0，效果無效。此效果在對方回合也可以發動。②：怪獸區域的此卡因戰鬥、效果被破壞的場合可以發動。將此卡放置在自己的鐘擺區。',
    effectTags: ['同步召喚', '鐘擺怪獸', '效果無效'], relations: ['清透翼'], accent: '#71b7bb'
  }),
  makeCard({
    id: 'odd-eyes-rebellion-dragon', passcode: '45627618', nameZh: '異色眼反叛龍',
    nameJa: '覇王黒竜オッドアイズ・リベリオン・ドラゴン', nameEn: 'Odd-Eyes Rebellion Dragon', kind: 'monster', frame: 'xyz',
    attribute: '闇', race: '龍族', typeLine: '龍族／超量／鐘擺／效果', level: null, rank: 7, atk: 3000, def: 2500,
    pendulumScaleLeft: 4, pendulumScaleRight: 4,
    pendulumText: '①：1回合1次，另一邊自己的鐘擺區沒有卡存在的場合可以發動。從牌組將1隻鐘擺怪獸放置到自己的鐘擺區。',
    ruleText: '龍族等級7怪獸×2\n等級7可以鐘擺召喚的場合，可從額外牌組將表側表示的此卡鐘擺召喚。①：此卡以超量怪獸為素材超量召喚的場合發動。將對方場上等級7以下的怪獸全部破壞，給予對方破壞數量×1000傷害。此回合，此卡在1次戰鬥階段中可以攻擊3次。②：怪獸區域的此卡因戰鬥、效果被破壞的場合可以發動。將自己鐘擺區的卡全部破壞，將此卡放置到自己的鐘擺區。',
    effectTags: ['超量召喚', '鐘擺怪獸', '多次攻擊'], relations: ['異色眼'], accent: '#9f4964'
  }),
  makeCard({
    id: 'decode-talker', passcode: '01861629', nameZh: '解碼語者',
    nameJa: 'デコード・トーカー', nameEn: 'Decode Talker', kind: 'monster', frame: 'link',
    attribute: '闇', race: '電子界族', typeLine: '電子界族／連結／效果', level: null,
    linkRating: 3, linkArrows: [1, 4, 6], atk: 2300, def: null,
    ruleText: '效果怪獸2隻以上。此卡的攻擊力上升此卡連結端怪獸數量×500。以自己場上的卡為對象的卡或效果發動時，解放此卡連結端1隻自己的怪獸才能發動：那個發動無效並破壞。',
    effectTags: ['連結召喚', '效果無效'], relations: ['碼語者'], accent: '#286fba'
  }),
  makeCard({
    id: 'monster-reborn', passcode: '83764718', nameZh: '死者蘇生',
    nameJa: '死者蘇生', nameEn: 'Monster Reborn', kind: 'spell', frame: 'spell',
    attribute: '魔法', race: '通常魔法', typeLine: '通常魔法', level: null, atk: null, def: null,
    ruleText: '以任一方墓地1隻怪獸為對象才能發動。特殊召喚那隻怪獸到自己場上。',
    effectTags: ['通常魔法', '特殊召喚'], accent: '#2d9e82'
  }),
  makeCard({
    id: 'dragon-ravine', passcode: '62265044', nameZh: '龍之溪谷',
    nameJa: '竜の渓谷', nameEn: 'Dragon Ravine', kind: 'spell', frame: 'spell',
    attribute: '魔法', race: '場地魔法', typeLine: '場地魔法', level: null, spellTrapIcon: 'field', atk: null, def: null,
    ruleText: '每回合1次，捨棄1張手牌，從以下效果選擇1個發動：從牌組把1隻等級4以下的「龍盟」怪獸加入手牌；或從牌組把1隻龍族怪獸送入墓地。',
    effectTags: ['場地魔法', '牌組檢索', '送入墓地'], relations: ['龍族'], accent: '#329a78'
  }),
  makeCard({
    id: 'mystical-space-typhoon', passcode: '05318639', nameZh: '旋風',
    nameJa: 'サイクロン', nameEn: 'Mystical Space Typhoon', kind: 'spell', frame: 'spell',
    attribute: '魔法', race: '速攻魔法', typeLine: '速攻魔法', level: null, spellTrapIcon: 'quick-play', atk: null, def: null,
    ruleText: '以場上1張魔法或陷阱卡為對象才能發動。破壞那張卡。',
    effectTags: ['速攻魔法', '魔陷破壞'], accent: '#3a9985'
  }),
  makeCard({
    id: 'black-luster-ritual', passcode: '55761792', nameZh: '混沌的儀式',
    nameJa: 'カオスの儀式', nameEn: 'Black Luster Ritual', kind: 'spell', frame: 'spell',
    attribute: '魔法', race: '儀式魔法', typeLine: '儀式魔法', level: null, spellTrapIcon: 'ritual', atk: null, def: null,
    ruleText: '「混沌士兵」降臨所必需。從自己的手牌、場上把等級合計為8以上的怪獸解放，從手牌儀式召喚「混沌士兵」。',
    effectTags: ['儀式魔法', '儀式召喚'], relations: ['混沌士兵'], accent: '#3f9981'
  }),
  makeCard({
    id: 'magic-cylinder', passcode: '62279055', nameZh: '魔法筒',
    nameJa: '魔法の筒', nameEn: 'Magic Cylinder', kind: 'trap', frame: 'trap',
    attribute: '陷阱', race: '通常陷阱', typeLine: '通常陷阱', level: null, atk: null, def: null,
    ruleText: '對方怪獸攻擊宣言時，以那1隻攻擊怪獸為對象才能發動。那隻攻擊怪獸的攻擊無效，給予對方其攻擊力數值的傷害。',
    effectTags: ['通常陷阱', '攻擊無效', '效果傷害'], accent: '#a64a82'
  }),
  makeCard({
    id: 'solemn-judgment', passcode: '41420027', nameZh: '神之宣告',
    nameJa: '神の宣告', nameEn: 'Solemn Judgment', kind: 'trap', frame: 'trap',
    attribute: '陷阱', race: '反擊陷阱', typeLine: '反擊陷阱', level: null, spellTrapIcon: 'counter', atk: null, def: null,
    ruleText: '支付一半生命值才能發動。魔法、陷阱卡發動時，或自己、對方召喚、反轉召喚、特殊召喚怪獸之際：那個發動或召喚無效並破壞。',
    effectTags: ['反擊陷阱', '召喚無效', '效果無效'], accent: '#a24c86'
  }),
  makeCard({
    id: 'call-of-the-haunted', passcode: '97077563', nameZh: '活死人的呼聲',
    nameJa: 'リビングデッドの呼び声', nameEn: 'Call of the Haunted', kind: 'trap', frame: 'trap',
    attribute: '陷阱', race: '永續陷阱', typeLine: '永續陷阱', level: null, spellTrapIcon: 'continuous', atk: null, def: null,
    ruleText: '以自己墓地1隻怪獸為對象發動此卡。把那隻怪獸以攻擊表示特殊召喚；此卡離開場上時破壞那隻怪獸，那隻怪獸被破壞時破壞此卡。',
    effectTags: ['永續陷阱', '特殊召喚'], accent: '#9a4c86'
  })
]
