# RUSH SHOP — 계좌이체 운영 흐름 개발본

## 배포 폴더 / Render 설정
- GitHub 저장소에 `rush_shop` 폴더와 그 안의 `package.json`, `server.js`, `public/`을 업로드
- Render Web Service의 Root Directory: `rush_shop`
- Build Command: `npm install`
- Start Command: `npm start`

## Render 환경변수 필수 설정
- `NODE_ENV=production`
- `SESSION_SECRET`: 충분히 긴 무작위 비밀 문자열
- `ADMIN_PASSWORD`: 관리자 전용 강력한 비밀번호
- `CDK_ENCRYPTION_KEY`: 아래 명령으로 생성한 64자리 16진수 키
- `BANK_NAME`: 은행명
- `BANK_ACCOUNT`: 계좌번호
- `BANK_HOLDER`: 예금주
- `DB_PATH`: 영구 디스크를 연결했다면 해당 디스크 경로 (예: `/var/data/rush-shop.sqlite`)

키 생성 명령:
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 구현된 흐름
1. 관리자가 관리자 페이지(`/admin.html`)에서 CDK 재고를 암호화 등록
2. 관리자가 상품 가격을 설정하고 판매를 활성화
3. 고객이 이름, 이메일, 조회 PIN을 입력해 주문 생성
4. 고객에게 주문번호와 계좌이체 정보 표시
5. 관리자가 실제 은행 입금 내역을 대조한 뒤 `입금 확인 및 코드 배정` 실행
6. 주문과 CDK가 하나의 DB 트랜잭션으로 연결되며 재고 중복 배정 방지
7. 고객은 주문번호 + 이메일 + PIN으로 조회해 입금 상태 및 발급 코드 확인

## 운영 전 반드시 완료할 사항
- Render의 영구 디스크 또는 외부 영구 DB를 구성하세요. 기본 로컬 파일시스템은 재배포/재시작 시 데이터가 사라질 수 있습니다.
- `SESSION_SECRET`, `ADMIN_PASSWORD`, `CDK_ENCRYPTION_KEY`, 계좌 정보는 Render Environment에만 설정하고 GitHub에 올리지 마세요.
- 실제 CDK 재판매 권한, 대상 지역/플랫폼, 유효기간, 환불 조건을 문서로 확인하세요.
- 사업자 정보, 이용약관, 개인정보 처리방침, 환불/청약철회 정책 및 고객 문의 경로를 준비하세요.
- 입금 승인 전에 반드시 실제 은행 거래내역과 입금자명·금액을 직접 대조하세요. 이 시스템은 은행 입금 자동 확인을 하지 않습니다.
- 이메일/SMS 알림은 아직 연동되어 있지 않습니다. 고객에게는 주문 생성 화면에서 주문번호와 계좌정보를 표시하고, 코드 조회는 사이트에서 제공합니다. 미입금 주문이 현재 재고 수량을 초과하지 않도록 주문 가능 수량을 제한합니다.
- 운영 전 테스트 계좌/테스트 코드로 전체 흐름을 검증하세요.

## 보안 및 기술 메모
- CDK는 AES-256-GCM 암호화 저장, SHA-256 중복 검사
- 주문 조회 PIN은 scrypt 해시 저장
- 주문 조회 시 주문번호·이메일·PIN을 모두 확인
- 입금 승인과 코드 배정은 SQLite 트랜잭션으로 처리
- SQLite DB 파일과 암호화 키를 함께 안전하게 백업하세요. 암호화 키를 잃으면 기존 CDK를 복호화할 수 없습니다.
- 운영 전 HTTPS, 관리자 MFA, 세션 저장소, rate limiting, 백업/복구 테스트를 추가 권장합니다.
