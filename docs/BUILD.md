# 프론트엔드 빌드 가이드 (Canonical)

## 빌드 위치
**반드시 이 디렉터리(`docs/`)에서만 빌드합니다.**

- GitHub Pages 가 `docs/` 루트를 서빙하므로, 여기서 빌드한 `assets/*.js` 와 `index.html` 이 곧 프로덕션 산출물입니다.
- 과거에 존재했던 `C:\Users\<user>\AppData\Local\Temp\service-build\` 같은 임시 빌드 디렉터리는 **폐기**되었습니다. 그런 경로에서 빌드·커밋하면 `config.js` 의 `workerUrl` 이 구 버전으로 drift 될 수 있습니다 (과거 실제 사고).

## 빌드 명령
```bash
cd docs
npm install     # 최초 1회
npm run build   # node build.js 실행
```

## build.js 동작
1. **Prebuild drift guard** — `src/utils/config.js` 의 `workerUrl` 이 canonical 값(`https://lab.ttimes.workers.dev`, lab/test 환경)과 일치하는지 검사. 불일치 시 빌드 중단.
2. `index.html` 의 `<script src>` 를 dev entry(`/src/main.jsx`)로 교체.
3. `vite build` 실행.
4. `dist/assets/*` → `docs/assets/`, `dist/index.html` → `docs/index.html` 복사.
5. **Postbuild drift guard** — 번들된 JS 에 `FORBIDDEN_WORKER_URLS` (과거 URL) 가 잔존하지 않는지, canonical URL 이 어느 JS 에든 포함되어 있는지 검사.

## Canonical URL 변경 시
`build.js` 상단의 `CANONICAL_WORKER_URL` 과 `src/utils/config.js` 의 `workerUrl` 을 **같은 커밋에서 함께 수정**하세요. 둘 중 하나만 바꾸면 drift guard 가 빌드를 막습니다.

## 배포
```bash
git add docs/assets docs/index.html docs/src/utils/config.js
git commit -m "..."
git push
```
GitHub Pages 가 1~2 분 내에 반영.
