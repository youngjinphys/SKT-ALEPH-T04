# Submission text template

> 아래 문구는 최종 배포 상태와 본인의 실제 작업 분담에 맞게 마지막으로 사실 확인한 뒤 제출합니다.

## 짧은 확인 방법
1. **어디로 가나요:** 제출한 공개 HTTPS 대시보드 URL을 새 시크릿 창에서 엽니다.
2. **3단계 이내 무엇을 하나요:** `LIVE REFRESH`로 실제 공개 값을 확인한 뒤, `Failure Lab`에서 `RESET → D1-A → D1-B → TIMEOUT`을 실행하고 표시된 `RETRY`를 누릅니다.
3. **무엇이 보이면 통과인가요:** live 영역에 값·단위·공개 출처·source observed/period·조회시각·Asia/Seoul이 보이고, history의 두 실제 행에서 각 source URL/관측일을 확인할 수 있습니다. 합성 시험은 timeout에서 `stale/timeout + 105 + 1 row`, retry 뒤 `fresh/none + 120 + 2 rows`가 됩니다.
4. **안 될 때 무엇이 보이나요:** timeout/auth/rate_limit/offline/schema_error가 서로 구분되고, 정상값이 있었으면 그 값은 `STALE / LAST GOOD VALUE`로 보존됩니다. 최초 조회부터 실패했다면 `UNAVAILABLE / NO GOOD VALUE`로 표시되어 존재하지 않는 정상값을 꾸며내지 않습니다.

## AI 사용 내역
- **AI에게 맡긴 일:** 공개 계약 35개 조건 분석, 아키텍처/테스트 초안, fixture 상태전이 구현, UI 구현과 adversarial QA 및 보안 체크리스트 작성.
- **학생이 직접 판단한 일:** 공개 원천으로 SANS ISC/DShield aggregate port 22 report count를 선택하고, 개인 ModSecurity 원본 로그를 공개 원천으로 사용하지 않기로 결정. 완료된 UTC 24시간 창을 비교하고 KST 날짜로 저장하는 정책을 채택.
- **AI 제안을 따르지 않은 일:** 실제 원천이 날짜 정밀도만 제공하는데 정확한 시각처럼 꾸며 표시하는 방식은 사용하지 않음. `day precision`을 명시하고 source period와 함께 표시.

## 제출 전 필수 입력
- 결과물 URL: `https://...`
- 소스 URL: `https://github.com/youngjinphys/SKT-ALEPH-T04/tree/<40자리 commit SHA>/`
- 서로 다른 KST 실제 날짜의 sealed `t04_day` receipt: **정확히 2건**
