# 함께 두는 외부 자원(오프라인판)

시안을 인터넷 없이 열 수 있도록 외부 라이브러리·글꼴을 이 폴더에 둠(2026-10-07). 지도 타일은 지도 제공처 이용 조건 때문에 두지 않으며, 연결이 없으면 화면이 격자 배경으로 바뀜.

| 자원 | 원천 | 사용 허가 |
|---|---|---|
| `leaflet/` | Leaflet 1.9.4 (unpkg.com/leaflet@1.9.4/dist) | BSD 2-Clause (`leaflet/LICENSE`) |
| `fonts/IBMPlex*.woff2` | IBM Plex Sans·Mono, Google Fonts 배포본(라틴·라틴 확장) | SIL OFL 1.1 (`fonts/LICENSE_IBM_Plex.txt`) |
| `fonts/NanumSquare*.woff2` | 나눔스퀘어 2.0 (moonspam/NanumSquare) | SIL OFL 1.1(네이버 나눔글꼴) |

- 글꼴 선언은 `fonts/fonts.css`에 모음. IBM Plex Sans는 가변 글꼴 하나로 400~700을 씀.
- 운영 화면 적용 여부와 사용 허가 조건 최종 확인은 설계서 13장 미결 사항을 따름.
