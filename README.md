# カラオケ録音オリジナル

ブラウザだけで動くカラオケ録音アプリです。YouTube か端末の音楽ファイルを流しながら、自分の声を録音できます。

公開ページ: https://syuu61300-art.github.io/Nichiyoubi-rec/

## ファイル

| ファイル | 役割 |
|---|---|
| `index.html` | アプリ本体。ホーム画面用のアイコンもこの中に入っています |
| `karaoke-youtube-eq.user.js` | YouTube 用ユーザースクリプト（任意）：イコライザー、歌詞の自動同期、広告のスキップボタンを自動で押す・広告中は消音 |

## ユーザースクリプトの入れ方（PC の Chrome）

1. Chrome に拡張機能「Tampermonkey」を入れる
2. `chrome://extensions` → Tampermonkey の「詳細」→「ユーザー スクリプトを許可する」をオン
3. https://syuu61300-art.github.io/Nichiyoubi-rec/karaoke-youtube-eq.user.js を開いて「インストール」

iPhone の Safari では「Userscripts」アプリで同じ URL を追加します。ホーム画面に追加したアプリの中ではユーザースクリプトは動きません。

## 保存場所

録音・歌詞・プレイリストはすべてその端末の中だけに保存され、どこにもアップロードされません。
