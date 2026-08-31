# 秘藏決鬥圖鑑（Arcana Archive）

純單機、個人欣賞用途的遊戲王卡片圖鑑與藝術加工雛型。目前完成：

- A：本機 SQLite 圖鑑、跨語言搜尋、效果／關聯／適配性標籤、卡圖與規則版本切換。
- B：仿 Duel Links Chronicle Card 的分層加工實驗室（表面、範圍、邊框、卡名、印章）。
- C、D：導覽與資料邊界已預留，尚未實作。

## 啟動

可直接使用 [`輔助批次檔`](./輔助批次檔) 內的批次檔：

1. 首次執行 `install.bat`。
2. 日常執行 `run.bat`。它會優先使用本專案 Electron；若 binary 尚未快取，可只讀借用 `C:\War3ModelElectron` 的既有 Electron 執行檔。
3. 驗證正式建置執行 `rebuild.bat`。
4. 清除可重建檔案前，先執行 `pure.bat --dry-run` 預覽。

也可在 PowerShell 手動執行：

```powershell
npm install
npm run dev
```

完整研究、資料來源選擇與階段規劃請見 [`Doc/開發計畫.md`](./Doc/開發計畫.md)。

> 卡名、卡片文字與圖像的權利屬於其各自權利人。本專案沒有獲得 KONAMI 背書，請勿把雛型內的資料或圖片重新散布或商用。
