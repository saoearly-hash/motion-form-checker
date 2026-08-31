# モーションフォームチェック

動画をアップロード → AIで骨格検知(オーバーレイ表示)→ 一時停止して線・文字を書き込み → 画像として保存、ができるツールです。
ビルド不要の静的サイト(HTML/CSS/JS のみ)なので、そのままどこにでもホスティングできます。

## できること

- 動画ファイルを選んで再生 / シークバーで移動 / 音声のミュート切り替え
- AIによる骨格検知のオーバーレイ表示(MediaPipe Pose Landmarker, 33点、最大5人まで同時検知)
- 複数人が映っている場合は、検知された人に番号バッジが表示されるのでタップして検知対象を選択(別の人をタップすれば切り替え、「対象をリセット」で全員表示に戻る)
- 「骨格検知」トグルで検知のON/OFF切り替え
- 「描画モード」トグルをONにすると、一時停止した状態でペンや文字を書き込める(OFFのときは書き込みできず、通常の再生操作だけができるので誤操作を防止)
- 書き込んだ結果(動画フレーム+骨格+注釈)をPNG画像として保存
- スマホ・iPad・PCの画面サイズに合わせて表示エリアを自動調整

## ローカルで試す

Node.js が入っていれば、このフォルダで:

```bash
npx serve .
```

表示されたURL(例: http://localhost:3000)をPCのブラウザで開いてください。
同じWi-Fiにいるスマホ/iPadから使う場合は、PCのローカルIPアドレス(例: http://192.168.x.x:3000)でアクセスしてください。

Python がある場合は代わりに:

```bash
python -m http.server 8000
```

## GitHubと連携してデプロイする(GitHub Pages)

このリポジトリには `.github/workflows/deploy.yml` を用意済みです。`main` ブランチにpushするたびに、GitHub Actionsが自動でGitHub Pagesへデプロイします。以下の手順を、このフォルダ(`motion-form-checker`)で順番に実行してください。

### 1. コミットする(初回のみ、Git利用者情報の設定が必要な場合)

このマシンにはまだGitのユーザー名・メールアドレスが設定されていなかったため、コミットは未実施です。まだ設定していない場合は先に設定してください:

```bash
git config --global user.name "あなたの名前"
git config --global user.email "you@example.com"
```

設定済みなら、このフォルダで変更をコミットします(`git init` と `git add -A` は実行済みです):

```bash
git commit -m "Initial commit: motion form checker"
```

### 2. GitHubに新しいリポジトリを作る

https://github.com/new を開き、リポジトリ名(例: `motion-form-checker`)を入力して作成してください。**READMEやgitignoreは追加しない**(既にこのフォルダにあるため)。

### 3. リモートを設定してpush

GitHubのリポジトリ作成後に表示される「…or push an existing repository from the command line」のURLを使って、このフォルダで実行します(`<あなたのGitHubユーザー名>` は置き換えてください):

```bash
git branch -M main
git remote add origin https://github.com/<あなたのGitHubユーザー名>/motion-form-checker.git
git push -u origin main
```

### 4. GitHub Pagesを有効化(初回のみ)

GitHub上のリポジトリで **Settings → Pages** を開き、「Build and deployment」の **Source** を **GitHub Actions** に設定してください。これで push のたびに自動デプロイされます。

初回pushから数十秒〜数分待つと、**Settings → Pages** の画面に公開URL(`https://<ユーザー名>.github.io/motion-form-checker/`)が表示されます。デプロイの進行状況はリポジトリの **Actions** タブから確認できます。

以降は、コードを変更して `git add -A && git commit -m "..." && git push` するだけで、自動的に最新版が公開されます。

### 他の方法(GitHub連携が不要な場合)

- **Netlify Drop**: https://app.netlify.com/drop にこのフォルダをドラッグ&ドロップするだけで公開URLが発行されます(アカウント登録なしでも試せます)
- **Vercel**: `npx vercel` をこのフォルダで実行(初回はログインが必要)

公開後に発行されるURLを、スマホ・iPad・PCそれぞれのブラウザで開けば利用できます。

## 注意点

- AIモデル(骨格検知)はGoogleのCDNからブラウザが直接読み込みます。初回利用時はインターネット接続が必要です(2回目以降はブラウザキャッシュが効きやすくなります)。
- カメラは使用せず、動画ファイルのアップロードのみに対応しています。
- 精度を上げたい場合は `app.js` 内の `MODEL_URL` を lite → full / heavy モデルに変更できます(その分、読み込みと処理は重くなります)。
