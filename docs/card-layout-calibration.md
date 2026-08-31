# 卡片版面校正基準

## 圖片選用原則

- 幾何位置只以正面、單張、無決鬥盤面與無透視變形的卡片圖片校正。
- Master Duel／Duel Links 的決鬥畫面僅用來理解介面中的卡片分類，不再拿來量測卡名、效果框或 ATK／DEF 座標。
- 空白框、屬性、等級、階級與卡種圖示沿用 `kooriookami/yugioh-card` 的高解析素材；文字位置以 Konami 官方單卡圖覆核。

## 官方參考

- Yu-Gi-Oh! Neuron 單卡詳細頁：
  - Blue-Eyes White Dragon: https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=4007&ope=2&request_locale=en
  - Cyber Angel Benten: https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=6845&ope=2&request_locale=en
  - Elemental HERO Nova Master: https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=9439&ope=2&request_locale=en
  - Stardust Dragon: https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=7734&ope=2&request_locale=en
  - Number 39: Utopia: https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=9575&ope=2&request_locale=en
  - Odd-Eyes Pendulum Dragon: https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=11213&ope=2&request_locale=en
  - Clear Wing Fast Dragon（完整中文效果）: https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=12828&ope=2&request_locale=cn
  - Odd-Eyes Rebellion Dragon: https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=11835&ope=2&request_locale=en
  - Red Supernova Dragon（完整中文長文本）: https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=14957&ope=2&request_locale=cn
- Duel Links 官方卡盒頁：
  - Judgement Force（同步／儀式／融合混合卡表）: https://www.konami.com/yugioh/duel_links/en/box/judgementforce/
  - Wings of Clearness（同步、鐘擺及同步／鐘擺）: https://www.konami.com/yugioh/duel_links/en/box/wingsofclearness/
  - Majestic Magic（融合、同步、超量、儀式與連結）: https://www.konami.com/yugioh/duel_links/en/box/majesticmagic/
  - Red Supernova（長效果同步怪獸）: https://www.konami.com/yugioh/duel_links/en/box/redsupernova/

## 文字模式

- `fit`：從固定上限開始，以實際效果框高度做二分搜尋；僅在溢位時縮小。
- `scroll`：維持同一固定上限，超出的內容在效果框內垂直捲動。
- 兩種模式的主要效果文字上限皆為實卡基準寬度的 `44 / 1394`；鐘擺效果文字採同一 44px 基準。
- 儀式、融合、同步、超量與連結卡的第一段素材／召喚條件獨立成行。
