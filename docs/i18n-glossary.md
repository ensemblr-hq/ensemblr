# i18n glossary

Ensemblr's product vocabulary in the three shipped languages. Fix a term here
**before** translating a slice — without it "workspace" ends up rendered three
different ways across the migration and the fix is a cross-cutting rename after
the fact.

Rules of thumb:

- **Do not translate proper nouns.** `Ensemblr`, `Pi`, `Claude Code`, `Codex`,
  `Linear`, `GitHub`, `git`, `npm` stay as-is in every language.
- **Do not translate git porcelain.** `commit`, `branch`, `merge`, `rebase`,
  `stash`, `worktree`, `HEAD`, `main`/`master` are borrowed, not localized —
  Russian and Greek developers use the English terms daily and a translation
  reads as a different concept. Where a case ending is unavoidable, transliterate
  (`коммит`, `коммита`).
- **Prefer the shortest term that survives a narrow column.** Russian and Greek
  run 15–30% longer than English; sidebar and tab-strip labels are the tightest
  budget in the app.
- **Keep imperative mood for buttons** in all three languages.

## Core nouns

| English | Русский | Ελληνικά | Note |
| --- | --- | --- | --- |
| Workspace | Рабочее пространство | Χώρος εργασίας | The isolated per-task copy of a repo. Never "проект"/"έργο" — that is `project`. |
| Repository | Репозиторий | Αποθετήριο | |
| Project | Проект | Έργο | The imported local repo, as distinct from a workspace. |
| Worktree | Worktree | Worktree | Git term; untranslated. |
| Branch | Ветка | Κλάδος | |
| Commit | Коммит | Commit | |
| Pull request | Pull request | Pull request | Untranslated; `PR` stays `PR`. |
| Diff | Diff | Diff | Untranslated — "различия"/"διαφορές" reads as prose, not the view. |
| Review comment | Комментарий к ревью | Σχόλιο αξιολόγησης | |
| Checkpoint | Контрольная точка | Σημείο ελέγχου | |
| Harness | Харнесс | Harness | The Claude Code / Codex terminal integration. Ensemblr-specific. |
| Agent | Агент | Πράκτορας | |
| Sub-agent | Суб-агент | Υποπράκτορας | An agent another agent delegated to — Claude Code's `Task` tool, and Ensemblr's own spawned conversations. Both terms were already fixed by the control-tool copy; this row records them. |
| Conversation | Диалог | Συνομιλία | The chat tab's thread. |
| Chat | Чат | Συνομιλία | The tab as the user opens it — `New chat` is `Новый чат`/`Νέα συνομιλία`. Russian splits the two: the thing you open is a `чат`, the thread inside it is a `диалог`. Greek uses `συνομιλία` for both. One exception in Russian: a chat that is over — a closed tab in history, a transcript offered to the composer — is named for the thread it left behind, so `Untitled chat` is `Диалог без названия` (`session-tabs.untitled-closed`, `review:file-diff.untitled-chat`). |
| Turn | Ход | Γύρος | One agent request/response cycle. |
| Tab | Вкладка | Καρτέλα | |
| Dock | Док | Dock | The bottom panel strip. |
| Panel | Панель | Πίνακας | |
| Terminal | Терминал | Τερματικό | |
| Run script | Скрипт запуска | Σενάριο εκτέλεσης | Configured per repository, by name. |
| Setup script | Скрипт настройки | Σενάριο εγκατάστασης | |
| Spawn terminal | Дополнительный терминал | Πρόσθετο τερματικό | Literally "spawn" reads as biology in both; use "additional". |
| Scrollback | Буфер прокрутки | Ιστορικό κύλισης | How many lines a terminal pane retains. Russian takes the buffer metaphor (`буфер прокрутки`); Greek takes the history one (`ιστορικό κύλισης`) — a literal `buffer κύλισης` mixes scripts for no gain. |
| Plan mode | Режим плана | Λειτουργία σχεδίου | |
| Board | Доска | Πίνακας εργασιών | The kanban dashboard. |
| Setting | Настройка | Ρύθμιση | |
| Model | Модель | Μοντέλο | |
| Thinking level | Уровень размышления | Επίπεδο σκέψης | |
| Context usage | Использование контекста | Χρήση περιβάλλοντος | |
| Issue | Задача | Ζήτημα | Linear issue. |
| Tool call | Вызов инструмента | Κλήση εργαλείου | |
| Attachment | Вложение | Συνημμένο | |
| Pasted text | Вставленный текст | Επικολλημένο κείμενο | A long clipboard paste the composer stored as an attachment. Named for the act, not the file — "вставка"/"επικόλληση" reads as the gesture, and the chip labels a thing. |
| Token | Токен | Διακριτικό | Model context unit. Localized in both — it is not git porcelain and not a proper noun. |
| Dictation | Диктовка | Υπαγόρευση | Speaking a prompt into the composer. The feature, and the verb on its control (`Продиктовать`/`Υπαγόρευση`). |
| Transcription | Транскрибация | Μεταγραφή | Turning the recorded clip into text. Russian takes `транскрибация` over `расшифровка`, which also reads as *decryption*; Greek takes `μεταγραφή` over the much longer `απομαγνητοφώνηση`. |
| Microphone | Микрофон | Μικρόφωνο | |
| API key | Ключ API | Κλειδί API | `API` stays Latin in both — it is an initialism, not a translatable noun. |
| Remote | Удалённый | Απομακρυσμένο | The adjective is localized; the remote's *name* (`origin`) is not. |
| Merged | Выполнен merge | Έγινε merge | Past-tense PR status. `merge` stays borrowed per the git-porcelain rule; only the auxiliary is localized. |
| Setup wizard | Мастер настройки | Οδηγός εγκατάστασης | The first-run gate. "Мастер"/"οδηγός" is the platform word for a wizard; never "волшебник"/"μάγος". |
| Root directory | Корневой каталог | Ριζικός κατάλογος | The managed directory holding repos and workspaces. |
| Linked directory | Прикреплённая директория | Συνδεδεμένος κατάλογος | An arbitrary folder on disk a chat's agent was given access to. Deliberately `директория`, not the `каталог` of `Root directory`: for a folder the user picked themselves, `каталог` reads dated in Russian. `Каталог` stays for the managed root, which is Ensemblr's own structure. Greek uses `κατάλογος` for both. Never `рабочее пространство`/`χώρος εργασίας` — that is `Workspace`. |
| Link (a directory or issue) | Прикрепить | Σύνδεση | The verb on the composer's `+` menu. Russian uses `прикрепить`, matching how the composer's other rows read; `связать` was rejected as reading like establishing a relation rather than attaching a thing. |
| File preview | Предпросмотр | Προεπισκόπηση | The read-only file viewer tab. Already the term used across `file-preview.*`; recorded here now that a failure message names the surface itself rather than just describing a file. |
| Outside workspace | Вне рабочего пространства | Εκτός χώρου εργασίας | The marker on a preview of a file the agent wrote outside the workspace root — `/tmp`, `~/.claude/`, a sibling worktree. The full `Рабочее пространство`/`Χώρος εργασίας` is kept rather than the menu-title short form: this badge sits beside a file path, where "Вне пространства" alone would not say *which* space. |
| Permission mode | Режим разрешений | Λειτουργία δικαιωμάτων | How much an agent may do unattended. |
| Keyboard shortcut | Горячая клавиша | Συντόμευση πληκτρολογίου | Shortened to "Горячие клавиши"/"Συντομεύσεις" in the nav, where the column is tight. |
| Board status | Статус на доске | Κατάσταση πίνακα | The kanban column a workspace sits in: `Бэклог`/`Εκκρεμότητες`, `В работе`/`Σε εξέλιξη`, `На ревью`/`Σε αξιολόγηση`, `Готово`/`Ολοκληρώθηκε`, `Отменено`/`Ακυρώθηκε`. |
| Actions bot | Бот Actions | Bot του Actions | The GitHub Actions commenter. `Actions` is the product name and stays; only the noun in front of it is localized. |
| Managed root | Управляемый корневой каталог | Διαχειριζόμενος ριζικός κατάλογος | The root plus the directories Ensemblr creates under it. |
| Diagnostic | Диагностика | Διαγνωστικό | One coded problem a failed operation reports; the renderer translates it from the code, never from main's English. |
| Unread | Непрочитанный | Αδιάβαστο | A chat tab an agent has spoken in since the user last looked at it. Russian agrees with the noun it qualifies (`непрочитанный чат`, `непрочитанные сообщения`); Greek likewise (`αδιάβαστη συνομιλία`, `αδιάβαστα μηνύματα`). Never `новый`/`νέο` — that says the chat is new, not that it is waiting. |
| Notification | Уведомление | Ειδοποίηση | The macOS desktop notification Ensemblr posts when a chat needs the user. The settings label keeps the qualifier — `Уведомления на рабочем столе`/`Ειδοποιήσεις επιφάνειας εργασίας` — because the app also has in-app markers. |
| Notification sound | Звук уведомлений | Ήχος ειδοποιήσεων | The chime played alongside that notification. Plural in both languages: the switch governs every notification, not one. Never `сигнал`/`σήμα`, which reads as an alarm. |

## Core verbs

| English | Русский | Ελληνικά | Note |
| --- | --- | --- | --- |
| Steer | Направить | Καθοδήγηση | Interrupting an agent mid-turn. |
| Follow-up | Дополнение | Συμπλήρωμα | The queued/steering message. |
| Queue | В очередь | Σε ουρά | |
| Held | Удерживается | Κρατείται | A follow-up the `block` behavior keeps out of a running turn. |
| Paused | Пауза | Παύση | A queue that will not drain until the user says so. Distinct from Held: held is the setting, paused is the queue's state. |
| Next | Следующее | Επόμενο | The queued message the agent gets first. Neuter in both languages because it qualifies `сообщение`/`μήνυμα`, not the queue. |
| Archive | Архивировать | Αρχειοθέτηση | |
| Discard | Отменить изменения | Απόρριψη | Destructive; never plain "Отменить" (= Undo). |
| Undo | Отменить | Αναίρεση | |
| Restore | Восстановить | Επαναφορά | |
| Resume | Продолжить | Συνέχιση | |
| Retry | Повторить | Επανάληψη | |
| Stop | Остановить | Διακοπή | |
| Approve | Разрешить | Έγκριση | Tool approval. |
| Deny | Отклонить | Άρνηση | |
| Connect | Подключить | Σύνδεση | Linking an integration such as Linear or the GitHub CLI. |
| Spawn | Запустить | Εκκίνηση | Starting a sub-agent. |
| Clone | Клонировать | Κλωνοποίηση | |
| Push | Push | Push | Git; untranslated. |
| Merge | Merge | Merge | Git; untranslated. |
| Quit anyway | Всё равно завершить | Τερματισμός ούτως ή άλλως | The button that lets a quit through while agents are still working (`src/main/app/quit-guard-strings.ts`). Takes the verb from the menu-bar `Quit` (`Завершить`/`Τερματισμός`) rather than coining a second one. **Flag for native review:** the Greek runs to 25 characters; a shorter idiom may exist. |

## Native menu bar

The menu-bar titles sit side by side across the top of the screen, so they take
the shortest form that still reads. Submenu items inside them use the full term
from **Core nouns** — the width budget there is generous.

| English | Русский | Ελληνικά | Note |
| --- | --- | --- | --- |
| Workspace *(menu title)* | Пространство | Χώρος | Short form for the menu-bar title only; the full `Рабочее пространство`/`Χώρος εργασίας` is 20 and 14 characters and does not fit beside `Файл`/`Правка`/`Вид`. Submenu items keep the full term. **Flag for native review:** `Пространство` alone can read as "space", and only the neighbouring menu titles disambiguate it. |
| Create PR | Создать PR… | Δημιουργία PR… | `PR` stays `PR` per the `Pull request` row above. `Создать pull request…` is 21 characters. |
| Open Config File | Файл конфигурации | Αρχείο ρυθμίσεων | The English is already shortened from "Open Configuration File"; the verb is carried by the menu it sits in. |
| Run *(script toggle)* | Запуск | Εκτέλεση | The menu item that starts or stops the active run script, checked while it runs. Distinct from the `Run script` row above, which names the configured script itself. |

## Settings-page section names

| English | Русский | Ελληνικά |
| --- | --- | --- |
| General | Основные | Γενικά |
| Appearance | Внешний вид | Εμφάνιση |
| Models | Модели | Μοντέλα |
| Git | Git | Git |
| Providers | Провайдеры | Πάροχοι |
| Integrations | Интеграции | Ενσωματώσεις |
| Diagnostics | Диагностика | Διαγνωστικά |
| Shortcuts | Горячие клавиши | Συντομεύσεις |
| Experimental | Экспериментальные | Πειραματικά |
| Environment | Окружение | Περιβάλλον |
| Security | Безопасность | Ασφάλεια |
| Actions | Действия | Ενέργειες |
| Scripts | Скрипты | Σενάρια |
| Misc | Разное | Διάφορα |

"Advanced" was a section until the settings restructure split it into
**Shortcuts** plus rows folded into General and Appearance; it has no page and
no row of its own any more.

## Language names

Shown **untranslated** wherever the user picks a language — an endonym reads
identically in every UI language, which is the point of using one. Only the
`System` option is translated.

| Code | Endonym |
| --- | --- |
| `en` | English |
| `ru` | Русский |
| `el` | Ελληνικά |
