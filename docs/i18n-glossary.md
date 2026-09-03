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
| New workspace *(repository menu)* | Новое пространство | Νέος χώρος εργασίας | Russian takes the short `Пространство` from **Native menu bar** below rather than the full term, so the three rows of this menu read as a set. Greek keeps the full `Χώρος εργασίας`, which is short enough. The menu grows to fit its longest label (`WorkbenchContextMenuContent`), so this is a reading-speed call rather than a width one. **Flag for native review:** the same caveat as the menu-bar row — `Пространство` alone can read as "space". |
| Repository settings *(repository menu)* | Настройки | Ρυθμίσεις αποθετηρίου | Russian drops the qualifier the other two languages keep: the menu is opened from a repository row and its sibling item is `Удалить репозиторий…`, so the scope is already established. Never lengthen back to `Настройки репозитория` without also revisiting the two rows around it. |
| Workspace archive *(repository menu)* | Архив | Αρχείο χώρων εργασίας | Same call as the row above — Russian leans on the menu's own context. The noun is deliberately distinct from `Archive` (the verb, `Архивировать`) further down: this item opens the archive, it does not archive anything. |
| Machine *(the computer Ensemblr runs on)* | Система | Μηχάνημα | The user's own computer, as onboarding addresses it. Russian says `система` where English and Greek say *machine*: `эта машина` reads as hardware or as a VM, and onboarding is talking about the environment the CLIs get installed into. Accepted despite `система` also appearing in `системный диалог` and `файловая система` — those are qualified, and this one is always `эта`/`ваша`. Never `компьютер`, which the app uses nowhere else. |
| Project | Проект | Έργο | The imported local repo, as distinct from a workspace. |
| Worktree | Worktree | Worktree | Git term; untranslated. |
| Reclaim disk *(what archiving does)* | Освободить место | Ανάκτηση χώρου | Deleting a workspace's worktree folder while keeping its branch, so the disk comes back and the workspace does not have to. There is no button and no setting — archiving always does it, and the only surface is the size the success toast reports (`Освобождено {{size}} на диске.` / `Ανακτήθηκαν {{size}} χώρου στον δίσκο.`). Russian takes `Освободить место` (free up space) over a literal `Вернуть диск`, which reads as reclaiming hardware. Never `Очистить`/`Εκκαθάριση`, which the app already uses for clearing a chat. |
| Pruned *(a worktree)* | Место освобождено | Ο χώρος ανακτήθηκε | The state of an archived workspace whose folder was removed and whose branch was kept. Stated as an outcome rather than an adjective in both languages: `обрезанный`/`κλαδεμένος` are the horticultural sense of `prune` and say nothing about disk. Distinct from *destroyed*, below. |
| Destroyed *(a worktree)* | Worktree удалён | Το worktree διαγράφηκε | The state of an archived workspace whose folder **and** branch were both dropped, so its commits are gone. Kept plainly distinct from *pruned*: the two look identical in the archive list and only this wording tells the user which one comes back intact. |
| Residue *(after a prune)* | Файлы записаны обратно | Αρχεία γράφτηκαν ξανά | Files a straggling writer put back at a worktree path git had already emptied — a build that outlived the teardown, most often. Said as *what happened* rather than as a noun: `остаток`/`υπόλειμμα` read as debris the user must clean up, when the launch-time sweep clears it unasked. Never worded as a failure — the worktree **was** removed, and *pruned* above still holds. |
| Branch | Ветка | Κλάδος | |
| Commit | Коммит | Commit | |
| Uncommitted change | Изменение без коммита | Αλλαγή χωρίς commit | The working-tree change set. Russian says *without a commit* rather than a participle; Greek keeps the porcelain `commit`. Already the shape every `git:` catalogue row uses — reuse it rather than coining `незакоммиченный`/`μη υποβεβλημένη`. |
| Pull request | Pull request | Pull request | Untranslated; `PR` stays `PR`. |
| Diff | Diff | Diff | Untranslated — "различия"/"διαφορές" reads as prose, not the view. |
| Review comment | Комментарий к ревью | Σχόλιο αξιολόγησης | |
| Checkpoint | Контрольная точка | Σημείο ελέγχου | |
| Harness | Харнесс | Harness | The Claude Code / Codex terminal integration. Ensemblr-specific. |
| Agent | Агент | Πράκτορας | |
| Sub-agent | Суб-агент | Υποπράκτορας | An agent another agent delegated to — Claude Code's `Task` tool, and a conversation a *workspace* agent spawned. Both terms were already fixed by the control-tool copy; this row records them. **Not what the Concierge spawns:** its children are root orchestrators the user can open and talk to, so the same control tools are titled with `Chat` on that surface (`control-tool.*.concierge.*`) — `Запустил чат`/`Ξεκίνησε μια συνομιλία` rather than `Запустил суб-агента`. |
| Task *(the agent's own)* | Задача | Εργασία | One item on the checklist an agent keeps for itself — Claude Code's `TaskCreate`/`TaskUpdate` tools, rendered in the timeline. Russian shares `Задача` with `Issue` below by an explicit decision: `Задание` was considered and rejected as stilted, and the two never share a surface — a task row lives in the chat timeline, a Linear issue in its own panel. Greek keeps them apart anyway (`Ζήτημα` for the issue, `Εργασία` here). Its states reuse the wording already fixed for a board: `Pending` → `В ожидании`/`Σε αναμονή`, `In progress` → `В работе`/`Σε εξέλιξη`, `Completed` → `Выполнено`/`Ολοκληρώθηκε`. |
| Conversation | Диалог | Συνομιλία | The chat tab's thread. |
| Chat | Чат | Συνομιλία | The tab as the user opens it — `New chat` is `Новый чат`/`Νέα συνομιλία`. Russian splits the two: the thing you open is a `чат`, the thread inside it is a `диалог`. Greek uses `συνομιλία` for both. One exception in Russian: a chat that is over — a closed tab in history, a transcript offered to the composer — is named for the thread it left behind, so `Untitled chat` is `Диалог без названия` (`session-tabs.untitled-closed`, `review:file-diff.untitled-chat`). |
| Turn | Ход | Γύρος | One agent request/response cycle. |
| Runtime *(agent)* | Среда выполнения | Περιβάλλον εκτέλεσης | The CLI or SDK behind a provider — Pi, Claude Code. Deliberately **not** `рантайм`/`runtime` transliterated: unlike git porcelain this is not a word the user types, and the error rows put it in a sentence. Russian keeps `Ошибка выполнения` for the short `Runtime error` headline already in the timeline. |
| Provider *(agent)* | Провайдер | Πάροχος | Who serves the model, as distinct from the `Runtime` that talks to it. Singular of the `Providers`/`Провайдеры`/`Πάροχοι` settings section. |
| Session *(agent)* | Сессия | Συνεδρία | One runtime process bound to a chat. Not `Conversation`/`Диалог` — a chat outlives the sessions that served it, and "session closed" does not mean the thread is gone. |
| Concierge | Консьерж | Concierge | The app-level agent that sits above every project. A feature name rather than a proper noun, so Russian transliterates it (`Консьерж`, declinable: `Консьержу`, `Консьержа`); Greek keeps it Latin, matching `Harness` — `κονσιέρζ` reads as the hotel job rather than as a feature of the app. |
| Memory *(Concierge)* | Память | Μνήμη | The durable notes the Concierge writes to its own folder and recalls in a later session. Not `Context`/`Контекст`/`Περιβάλλον`, which is what a clear throws away — the whole point of the pair is that one survives the other. |
| In the background *(Concierge memory pass)* | В фоне | Στο παρασκήνιο | Where the retired conversation finishes writing its memories after a clear. The short adverbial in both — Russian's `в фоновом режиме` is the register a settings screen takes, and this sits in a one-line banner beside two buttons. |
| Context window | Контекстное окно | Παράθυρο περιβάλλοντος | The model's token ceiling for one turn. Takes `контекст`/`περιβάλλον` from `Context usage` rather than coining a second word. |
| Credentials | Учётные данные | Διαπιστευτήρια | The API key or sign-in a provider rejects. Not `Токен`/`token`, which names the stored OAuth credential specifically. |
| Prompt | Промпт | prompt | What the user sends the agent. Russian transliterates (`промпт`) — `запрос` is already `request` and `подсказка` reads as a UI hint. Greek keeps the English word, as the composer strings already do. |
| Composer | Поле ввода | Πεδίο | Named for the box, not the feature: neither language has a noun for "composer" that a sentence can point at, so both say *the input field* (`Изменить в поле ввода`, `Επεξεργασία στο πεδίο`). |
| Tab | Вкладка | Καρτέλα | |
| Dock | Док | Dock | The bottom panel strip. |
| Panel | Панель | Πίνακας | |
| Terminal | Терминал | Τερματικό | |
| Run script | Скрипт запуска | Σενάριο εκτέλεσης | Configured per repository, by name. |
| Setup script | Скрипт настройки | Σενάριο εγκατάστασης | |
| Spawn terminal | Дополнительный терминал | Πρόσθετο τερματικό | Literally "spawn" reads as biology in both; use "additional". |
| Scrollback | Буфер прокрутки | Ιστορικό κύλισης | How many lines a terminal pane retains. Russian takes the buffer metaphor (`буфер прокрутки`); Greek takes the history one (`ιστορικό κύλισης`) — a literal `buffer κύλισης` mixes scripts for no gain. |
| Command output | Вывод команды | Έξοδος εντολής | Verbatim stderr/stdout a failed `git` or `gh` call wrote, shown demoted under the explanation. Both terms were already fixed by `errors:failure.parse-failed`; this row records them. |
| Terminal output | Вывод терминала | Έξοδος τερματικού | What a terminal pane has printed, as the composer chip labels a selection taken from one. Built on `Command output` above rather than coining a second pattern — the chip names the surface the text came off, not the command that wrote it, because a selection may span several commands. |
| Plan mode | Режим плана | Λειτουργία σχεδίου | |
| Board | Доска | Πίνακας εργασιών | The kanban dashboard. |
| Setting | Настройка | Ρύθμιση | |
| Model | Модель | Μοντέλο | |
| Thinking level | Уровень размышления | Επίπεδο σκέψης | |
| Context usage | Использование контекста | Χρήση περιβάλλοντος | |
| Plan (subscription) | Тариф | Συνδρομή | The claude.ai subscription tier the account bills against. Deliberately **not** `план`/`σχέδιο`, which `Plan mode` already owns — the two are unrelated concepts and sharing a word makes "plan limits" read as a limit on planning. |
| Plan usage | Использование тарифа | Χρήση συνδρομής | How much of the subscription's rate-limit windows is spent. Mirrors `Context usage` in both languages. |
| Limit window | Окно лимита | Παράθυρο ορίου | One rolling rate-limit period (5-hour, weekly). Named for the period, not the ceiling. |
| Resets | Сброс | Επαναφορά | When a limit window starts over. The noun in both, so `Resets in 3h` reads as `Сброс через 3 часа`/`Επαναφορά σε 3 ώρες`. |
| Extra usage (overage) | Сверх тарифа | Επιπλέον χρήση | Spend past the plan's included allowance, billed on top of it. Russian takes the prepositional phrase rather than a noun — `перерасход` reads as an accounting overrun the user caused, not as a bucket the plan offers. |
| Billing | Оплата | Χρέωση | The payment side of the account, as distinct from the `Plan (subscription)` it pays for. Named where a usage limit may be a spending ceiling rather than a rolling `Limit window` — the two need different action from the reader. Russian takes `Оплата` over the transliterated `биллинг`, which is jargon nobody reads in a error row; Greek keeps the singular to sit beside `Συνδρομή`. |
| Issue | Задача | Ζήτημα | Linear issue. Russian shares `Задача` with `Task (the agent's own)` above; see that row for why the two are allowed to collide. |
| Issue state bucket | — | — | Linear's normalized `stateType`, which the browse list groups by because a team names its own columns freely. Six rows, five of them reusing the `Board status` wording above so one word never means two things: `Backlog` → `Бэклог`/`Εκκρεμότητες`, `In progress` → `В работе`/`Σε εξέλιξη`, `Done` → `Готово`/`Ολοκληρώθηκε`, `Canceled` → `Отменено`/`Ακυρώθηκε`. |
| Todo *(state bucket)* | К выполнению | Προς υλοποίηση | The bucket between `Backlog` and `In progress` — accepted work nobody has started. Kept as a phrase rather than borrowing `Todo`, which reads as a code marker in both languages. |
| Triage *(state bucket)* | Разбор | Διαλογή | Linear's intake queue: filed but not yet accepted into a team's flow. Russian takes `Разбор` over the transliterated `Триаж`, which is medical; Greek takes `Διαλογή`, the ordinary sorting sense. |
| Assignee | Исполнитель | Υπεύθυνος | Who an issue is assigned to. `Unassigned` is the negated phrase, not a separate noun: `Без исполнителя`/`Χωρίς υπεύθυνο`. |
| Unassigned | Без исполнителя | Χωρίς υπεύθυνο | The negated `Assignee` above, promoted to its own row because the dashboard board defines its GitHub backlog by it: an open issue nobody is on. Never `неназначенная`/`μη ανατεθειμένο`, which describe the issue rather than the missing person and read as jargon in both languages. |
| Backlog issue | Задача в бэклоге | Ζήτημα σε εκκρεμότητα | The unit the dashboard's Backlog column holds: an issue with no Ensemblr workspace yet. Takes `Бэклог`/`Εκκρεμότητες` from `Board status` below rather than coining a second word for the same column. Russian keeps the prepositional phrase — `бэклог-задача` reads as a compound noun the product does not have. |
| Source *(of a board card)* | Источник | Προέλευση | Where a dashboard card came from: an Ensemblr workspace, a Linear issue, or a GitHub issue. The toolbar facet is `Источники`/`Προελεύσεις`. Deliberately **not** the `Create workspace from source` picker's own wording, which enumerates branch/PR/issue rather than provider — the board facet names the provider. Russian takes `Источник` over `Происхождение`, which reads as provenance rather than a filterable category. |
| Label *(Linear)* | Метка | Ετικέτα | The colored tag a team puts on an issue. Russian takes `Метка` over `Ярлык`, which reads as a desktop shortcut; Greek takes `Ετικέτα`. An unset optional field is the negated phrase throughout the editor, matching `Assignee`: `Без статуса`/`Χωρίς κατάσταση`, `Без проекта`/`Χωρίς έργο`, `Без цикла`/`Χωρίς κύκλο`. |
| Cycle *(Linear)* | Цикл | Κύκλος | Linear's fixed-length iteration. Deliberately not `Спринт`/`Σπριντ`: Linear does not call it a sprint, and the editor's picker has to match the word the user sees in Linear itself. |
| Sort / Group *(list controls)* | Сортировка / Группировка | Ταξινόμηση / Ομαδοποίηση | The two pickers over a list. Nominative in every language, because each control's own value is what its trigger displays — a dative "по приоритету" reads as a fragment on a chip. |
| Tool call | Вызов инструмента | Κλήση εργαλείου | |
| Attachment | Вложение | Συνημμένο | |
| Attach to chat *(verb)* | Прикрепить к диалогу | Επισύναψη στη συνομιλία | The right-click action on a Files-tree row and a Changes row that hands the thing to the agent as a chip. Russian uses `прикрепить`, agreeing with `Link (a directory or issue)`, and `диалог` rather than `чат` because the content lands in the thread, not on the tab — matching `Comment is attached to the chat` → `Комментарий прикреплён к диалогу`. Greek `Επισύναψη`, the verb behind `Συνημμένο`, not the `Προσθήκη` of `Add to chat`. |
| Pasted text | Вставленный текст | Επικολλημένο κείμενο | A long clipboard paste the composer stored as an attachment. Named for the act, not the file — "вставка"/"επικόλληση" reads as the gesture, and the chip labels a thing. |
| Selection *(of terminal text)* | Выделение | Επιλογή | The text highlighted in a terminal pane, which its right-click menu attaches to the chat. Russian `выделение`, not `выбор` — the latter is a choice among options, which is what a picker offers. Greek `επιλογή` carries both senses and is unambiguous in the menu, where the only thing to select is text. |
| Composer | Поле ввода | Πεδίο σύνθεσης | The box a prompt is typed into. Recorded now that a failure message names the surface rather than only labelling it: the accessible names (`composer.aria-label`) already read `Поле ввода для агента`/`Σύνθεση μηνύματος πράκτορα`, and body copy takes the same noun. Never `композер`/`συνθέτης` — both read as a music composer. |
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
| Image | Изображение | Εικόνα | A raster picture the preview draws or refuses — a `.png`, a `.webp`, a `.tiff` it cannot decode. Deliberately not `картинка`/`φωτογραφία`: the preview handles diagrams and icons as much as photos, and the format name beside it (`TIFF`, `HEIC`) stays untranslated. |
| Outside workspace | Вне рабочего пространства | Εκτός χώρου εργασίας | The marker on a preview of a file the agent wrote outside the workspace root — `/tmp`, `~/.claude/`, a sibling worktree. The full `Рабочее пространство`/`Χώρος εργασίας` is kept rather than the menu-title short form: this badge sits beside a file path, where "Вне пространства" alone would not say *which* space. |
| Permission mode | Режим разрешений | Λειτουργία δικαιωμάτων | How much an agent may do unattended. |
| Keyboard shortcut | Горячая клавиша | Συντόμευση πληκτρολογίου | Shortened to "Горячие клавиши"/"Συντομεύσεις" in the nav, where the column is tight. |
| Board status | Статус на доске | Κατάσταση πίνακα | The kanban column a workspace sits in: `Бэклог`/`Εκκρεμότητες`, `В работе`/`Σε εξέλιξη`, `На ревью`/`Σε αξιολόγηση`, `Готово`/`Ολοκληρώθηκε`, `Отменено`/`Ακυρώθηκε`. |
| Linear *(nav entry)* | Linear | Linear | The sidebar entry for the Linear issue browser. A proper noun, so it stays English in all three and is never transliterated to `Линеар`/`Λίνεαρ`. Replaced the generic `Issues`/`Задачи`/`Ζητήματα` label, which collided with the `Issue` row above once the dashboard board started holding GitHub issues too. |
| Actions bot | Бот Actions | Bot του Actions | The GitHub Actions commenter. `Actions` is the product name and stays; only the noun in front of it is localized. |
| Managed root | Управляемый корневой каталог | Διαχειριζόμενος ριζικός κατάλογος | The root plus the directories Ensemblr creates under it. |
| Diagnostic | Диагностика | Διαγνωστικό | One coded problem a failed operation reports; the renderer translates it from the code, never from main's English. |
| Unread | Непрочитанный | Αδιάβαστο | A chat tab an agent has spoken in since the user last looked at it. Russian agrees with the noun it qualifies (`непрочитанный чат`, `непрочитанные сообщения`); Greek likewise (`αδιάβαστη συνομιλία`, `αδιάβαστα μηνύματα`). Never `новый`/`νέο` — that says the chat is new, not that it is waiting. |
| Notification | Уведомление | Ειδοποίηση | The macOS desktop notification Ensemblr posts when a chat needs the user. The settings label keeps the qualifier — `Уведомления на рабочем столе`/`Ειδοποιήσεις επιφάνειας εργασίας` — because the app also has in-app markers. |
| Notification sound | Звук уведомлений | Ήχος ειδοποιήσεων | The chime played alongside that notification. Plural in both languages: the switch governs every notification, not one. Never `сигнал`/`σήμα`, which reads as an alarm. |
| Secret | Секрет | Μυστικό | One stored credential — an API key, a token, a connection string. Russian takes `секрет` rather than `тайна`, which reads as a personal confidence; Greek `μυστικό` is the term the local developer community uses. |
| Account *(a connected integration)* | Аккаунт | Λογαριασμός | One sign-in to an external service the app holds credentials for — a Linear organization, an Infisical Machine Identity. Several can be connected at once, so the noun is always countable: `Добавить аккаунт`/`Προσθήκη λογαριασμού`, `2 аккаунта`/`2 λογαριασμοί`. Russian takes `аккаунт` over `учётная запись`, which is bureaucratic and twice as long in a settings row. |
| Organization *(Linear)* | Организация | Οργανισμός | The Linear workspace an account signs into, and the badge that tells two accounts' issues apart in a merged list. Deliberately **not** `Рабочее пространство`/`Χώρος εργασίας`, which Ensemblr's own `Workspace` already owns — Linear calls it a workspace, but reusing that word here would make an issue badge read as an Ensemblr workspace. |
| Sign-in *(to an integration)* | Вход | Σύνδεση | The OAuth round trip through the browser that connects one account, as distinct from `Connect`, which is the button that starts it. Names the service it goes to — `вход через Linear`/`σύνδεση με το Linear` — because a bare noun reads as signing in to Ensemblr itself, which has no account. |
| OAuth token | Токен | token | The stored credential an integration authenticates with, and the thing that expires and forces a reconnect. Not the `Token` row above, which is the model-context unit: Greek keeps this one Latin (`token`) rather than `Διακριτικό`, matching what the Linear settings copy already says, while Russian takes `токен` in both senses. |
| Machine Identity | Machine Identity | Machine Identity | Infisical's own product term for a non-human credential. Untranslated in both languages: it is the label on the Infisical screen the user has to open, so translating it would send them looking for something that is not there. |
| Client ID / Client Secret | Client ID / Client Secret | Client ID / Client Secret | The two Universal Auth fields, untranslated for the same reason as `Machine Identity` — they are copied verbatim off the Infisical screen. |
| Infisical project | Проект Infisical | Έργο Infisical | The Infisical-side container a repository links to. Takes the `Project` noun already fixed above, qualified by the proper noun so it is never confused with an Ensemblr project. |
| Secret path | Путь к секретам | Διαδρομή μυστικών | The folder inside an Infisical environment Ensemblr reads. Russian uses `путь к` rather than a bare genitive so it reads as a filesystem-style path, which is what it is. |
| Instance URL | Адрес инстанса | Διεύθυνση instance | Which Infisical deployment an account talks to — cloud US, cloud EU, or self-hosted. `Инстанс`/`instance` is left borrowed in both: it is infrastructure vocabulary developers use in English daily. |
| Link *(repository ↔ Infisical project)* | Связь | Σύνδεση | The saved pairing itself, and the state badges over it: `Связано`/`Συνδεδεμένο`, `Не связано`/`Χωρίς σύνδεση`, `Отвязать`/`Αποσύνδεση`. Deliberately **not** the composer's `Link (a directory or issue)` → `Прикрепить`: that verb attaches a thing to a chat, while this noun names a persistent relation between two systems. |
| Detected *(a link read from `.infisical.json`)* | Обнаружено | Εντοπίστηκε | The state badge over a link Ensemblr read out of the Infisical CLI's own `.infisical.json` rather than out of its own settings. Both languages take the impersonal past form — the app reports what it found, and neither `Обнаруженный`/`Εντοπισμένο` agrees with a noun the badge never shows. Distinct from `Связано`/`Συνδεδεμένο` above: nothing has been saved yet. |
| Update *(a newer build)* | Обновление | Ενημέρωση | The build the in-app updater downloads, as a noun. Distinct from the `Refresh` verb below, which Russian also renders `Обновить`: the noun here is always `обновление`, and the action that looks for one is `Проверить обновления`/`Έλεγχος για ενημερώσεις` — never a bare `Обновить`, which would read as re-fetching the screen. |
| Nightly *(the channel)* | Nightly | Nightly | The rolling build of `master`, published under the reserved `nightly` tag and installed as `Ensemblr Canary`. Untranslated in both, for the git-porcelain reason: the word is the tag name, the release title, and the download link on ensemblr.dev, so a localized badge would name something the user cannot find. |
| Release page | Страница релиза | Σελίδα έκδοσης | Where a build that may check for updates but not install them sends the user. `Релиз`/`έκδοση` matches the GitHub surface the link actually lands on, rather than reusing `Обновление`/`Ενημέρωση` from `Update` above — the page is the artifact listing, not the update itself. |
| Keyring | Хранилище ключей | Θησαυροφυλάκιο κλειδιών | The OS service that encrypts stored secrets: the macOS Keychain, gnome-keyring, or KWallet. Russian takes `хранилище ключей` over Apple's `связка ключей`, which names the macOS product specifically and reads wrong for a KDE wallet; Greek takes the descriptive compound over KDE's `πορτοφόλι`, for the same reason. The daemon names themselves stay English — they are what the user types to start one. |
| Title bar | Заголовок окна | Γραμμή τίτλου | The strip at the top of the window carrying its controls, and the Appearance setting choosing who draws it. Russian says `заголовок окна` rather than the calque `титульная строка`, which nobody uses; Greek keeps the standard `γραμμή τίτλου`. |
| Window controls | Элементы управления окном | Στοιχεία ελέγχου παραθύρου | The minimize / maximize / close cluster as a *group*, used only for the group's accessible label — the three buttons keep their own entries below. Both languages take the descriptive phrase over a calque of `controls`, which reads as media playback in Russian and as an audit in Greek. |
| Desktop entry | Desktop-запись | Εγγραφή desktop | The freedesktop `.desktop` file a Linux app installs so launchers can find it. `Desktop` stays English in both because it names the file extension and the spec, not a screen; only the noun around it is translated. The launcher binaries `gio` and `gtk-launch`, and the packages `glib` and `gtk3`, stay English — they are what the user types to install one. |

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
| Close | Закрыть | Κλείσιμο | Dismisses the surface and nothing else. A confirmation dialog swaps its `Cancel` for this once the run is in flight, because dismissing it no longer calls the operation back. |
| Discard | Отменить изменения | Απόρριψη | Destructive; never plain "Отменить" (= Undo). |
| Undo | Отменить | Αναίρεση | |
| Redo | Повторить | Επανάληψη | The history command, and the same pair `Retry` above takes — the two never share a menu, so the collision is invisible. |
| Cut | Вырезать | Αποκοπή | Clipboard operation, matching the Edit menu in `src/main/menu/menu-strings.ts`. |
| Copy | Копировать | Αντιγραφή | Imperfective in Russian, as every other `Копировать …` row in the catalogue already is. The native Edit menu says `Скопировать`; leave that one alone — it is macOS's own register for a menu-bar item. |
| Paste | Вставить | Επικόλληση | The act. The chip for what was pasted is `Pasted text` below. |
| Select all | Выбрать все | Επιλογή όλων | On a read-only surface this means the transcript the user right-clicked, not the window. Sentence case in the catalogue, like every other `common:actions.*` label; the Edit menu in `src/main/menu/menu-strings.ts` keeps `Select All` because Title Case is macOS's register for a menu-bar item. |
| Add to dictionary | Добавить в словарь | Προσθήκη στο λεξικό | Teaches the spellchecker a word for the whole user profile, not this window. macOS's own Edit menu says `Запомнить написание` for its `Learn Spelling`; this is a plainer label for a plainer action, so it is translated literally rather than borrowed. |
| No suggestions | Нет вариантов | Καμία πρόταση | Shown disabled when the spellchecker flags a word but offers no correction. |
| Restore | Восстановить | Επαναφορά | |
| Minimize *(the window)* | Свернуть | Ελαχιστοποίηση | The window control, not `Collapse` — Russian reuses `Свернуть` for both, but this one names an OS gesture and only ever appears on the window-control cluster. |
| Maximize / Restore *(the window)* | Развернуть / Восстановить | Μεγιστοποίηση / Επαναφορά μεγέθους | The one window control whose label flips with the window's state. Greek qualifies the restore with `μεγέθους` so it is not read as the `Restore` above, which un-archives a workspace. |
| Relaunch | Перезапустить | Επανεκκίνηση | Quitting and starting the same build again to apply a setting the window reads only at construction. Shares its wording with `Restart (into an update)` below on purpose: from the user's side the two are the same gesture, and only the reason differs. |
| Resume | Продолжить | Συνέχιση | |
| Retry | Повторить | Επανάληψη | |
| Continue *(a cut-off turn)* | Продолжить | Συνέχεια | The recovery on a runtime-error row: it sends the agent the word `Continue` so it resumes an answer the provider truncated. Distinct from `Retry` above, which re-sends the user's own prompt — Russian therefore keeps `Повторить` for retry and `Отправить снова` where the row has to say *which* prompt goes again. |
| Fork *(a chat)* | Fork | Fork | Untranslated in both, like git porcelain — `Fork диалога`, `Fork συνομιλίας`. `Ответвить`/`διακλάδωση` reads as a branch of the repository, which forking a chat is not. |
| Edit the prompt | Изменить промпт | Επεξεργασία prompt | The recovery on a refused turn: it puts the failed prompt back in the composer to reword rather than re-sending it. Distinct from `Retry`/`Continue` above, which both send something. |
| Stop | Остановить | Διακοπή | |
| Approve | Разрешить | Έγκριση | Tool approval. |
| Deny | Отклонить | Άρνηση | |
| Connect | Подключить | Σύνδεση | Linking an integration such as Linear or the GitHub CLI. |
| Assign an issue *(to a workspace)* | Создать рабочее пространство из задачи | Δημιουργία χώρου εργασίας από ζήτημα | Dragging a `Backlog issue` out of Backlog, which creates a workspace seeded from it. All three languages say **create a workspace from the issue**, never "assign"/`назначить`/`ανάθεση`: nothing is written back to Linear or GitHub (ADR 0024), and an assignment verb would promise the issue's own assignee changed. |
| Dismiss *(a backlog issue)* | Убрать с доски | Απόκρυψη από τον πίνακα | Hiding an issue from the board without touching it in Linear or GitHub. Deliberately not `Отклонить`/`Απόρριψη`, which `Deny` and `Discard` already own and which imply a decision about the work itself. The inverse reuses `Restore` above. |
| Refresh | Обновить | Ανανέωση | Re-fetching remote data. Both languages already use this form across the issue, PR, MCP-server, and provider surfaces; reuse it rather than coining `Перезагрузить`/`Επαναφόρτωση`, which read as reloading the app. |
| Re-run checks | Повторить проверки | Επανάληψη ελέγχων | The single button on the Providers page that re-probes the open provider's readiness checks. Deliberately not `Refresh`/`Обновить`/`Ανανέωση` above: nothing is re-fetched from a server — the app re-runs the local probes, which spawn the runtime. Russian keeps the imperative plural to match `Повторить проверку` already used by a single setup-check retry; Greek keeps the verbal noun. |
| Restart *(into an update)* | Перезапустить | Επανεκκίνηση | Quitting and relaunching to finish installing a downloaded update. Russian keeps the imperative for the button (`Перезапустить`) and Greek the verbal noun (`Επανεκκίνηση`), matching how `Archive`/`Αρχειοθέτηση` already splits. Never `Перезагрузить`/`Επαναφόρτωση`, which `Refresh` above already warns off. |
| Selected | Выбрано | Επιλεγμένο | Screen-reader-only checked state on a picker row, where the tick glyph is `aria-hidden`. Neuter short form, because it qualifies nothing on the page — it is announced on its own. |
| Spawn | Запустить | Εκκίνηση | Starting a sub-agent. |
| Clone | Клонировать | Κλωνοποίηση | |
| Push | Push | Push | Git; untranslated. |
| Merge | Merge | Merge | Git; untranslated. |
| Conflict *(merge)* | Конфликт | Σύγκρουση | A file that will not merge cleanly with the base branch, and the Checks section that lists them. The noun is localized even though `merge` beside it is not — hence `Конфликты merge`/`Συγκρούσεις merge` for the header badge, and a bare `Конфликты`/`Συγκρούσεις` where the context is already git. The adjectival form follows it (`конфликтующие файлы`/`αρχεία με συγκρούσεις`); never `коллизия`/`διένεξη`, which read as a hash collision and an interpersonal dispute. |
| Quit anyway | Всё равно завершить | Τερματισμός ούτως ή άλλως | The button that lets a quit through while agents are still working (`src/main/app/quit-guard-strings.ts`). Takes the verb from the menu-bar `Quit` (`Завершить`/`Τερματισμός`) rather than coining a second one. **Flag for native review:** the Greek runs to 25 characters; a shorter idiom may exist. |
| Show more / Show less | Развернуть / Свернуть | Ανάπτυξη / Σύμπτυξη | The control under a clipped block — a long user prompt in the timeline. Both languages say **expand**/**collapse** rather than translating "show more" literally (`Показать больше`/`Περισσότερα`): the app already fixed this pair on the answer-table and terminal-area controls, and the gesture is the same one. |

## Native menu bar

The menu-bar titles sit side by side across the top of the screen, so they take
the shortest form that still reads. Submenu items inside them use the full term
from **Core nouns** — the width budget there is generous.

| English | Русский | Ελληνικά | Note |
| --- | --- | --- | --- |
| Workspace *(menu title)* | Пространство | Χώρος | Short form for the menu-bar title; the full `Рабочее пространство`/`Χώρος εργασίας` is 20 and 14 characters and does not fit beside `Файл`/`Правка`/`Вид`. Submenu items keep the full term. Russian also takes this short form in the repository context menu — see `New workspace *(repository menu)*` in **Core nouns**; everywhere else the full term stands (210 call sites against these two). **Flag for native review:** `Пространство` alone can read as "space", and only the surrounding items disambiguate it. |
| Create or Update PR *(menu item)* | Создать или обновить PR… | Δημιουργία ή ενημέρωση PR… | `PR` stays `PR` per the `Pull request` row above. The item fires regardless of PR state and cannot relabel itself per state, so both verbs are named. `Создать pull request…` is 21 characters. |
| Open Config File | Файл конфигурации | Αρχείο ρυθμίσεων | The English is already shortened from "Open Configuration File"; the verb is carried by the menu it sits in. |
| Run *(script toggle)* | Запуск | Εκτέλεση | The menu item that starts or stops the active run script, checked while it runs. Distinct from the `Run script` row above, which names the configured script itself. |
| Application menu | Меню приложения | Μενού εφαρμογής | Screen-reader name for the whole bar, not a visible label — the one string in the menu that reaches the renderer catalogue, because the bar Ensemblr draws for itself on Linux is a renderer surface. The item labels inside it still come from `src/main/menu/menu-strings.ts`, already resolved to the user's language. |

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
| Secrets | Секреты | Μυστικά |
| Security | Безопасность | Ασφάλεια |
| Actions | Действия | Ενέργειες |
| Scripts | Скрипты | Σενάρια |
| Misc | Разное | Διάφορα |

"Advanced" was a section until the settings restructure split it into
**Shortcuts** plus rows folded into General and Appearance; it has no page and
no row of its own any more.

## About panel

The native About panel's credit headings, from
`src/main/menu/about-panel-strings.ts`. The package names, SPDX license
identifiers, and URLs listed beneath them are proper nouns and generated data —
never translated.

| English | Русский | Ελληνικά | Note |
| --- | --- | --- | --- |
| Core open-source projects | Основные проекты с открытым исходным кодом | Βασικά έργα ανοιχτού κώδικα | Heading over the app's **direct** runtime dependencies. "Core"/"Основные"/"Βασικά" rather than "Bundled"/"Встроенные"/"Ενσωματωμένα": the list is 49 packages where the production tree resolves to ~537, so a word claiming everything bundled would be false. All three read as "the main ones", which is what the list is. |
| Development tools | Инструменты разработки | Εργαλεία ανάπτυξης | Heading over the dev dependencies — used to build and test the app, not shipped in it. |
| Inspired by {{name}} | Вдохновлено проектом {{name}} | Με έμπνευση από το {{name}} | Credits the project Ensemblr takes design inspiration from. Russian adds `проектом` because a bare `Вдохновлено Conductor` cannot take a case ending on a Latin proper noun. |

## Language names

Shown **untranslated** wherever the user picks a language — an endonym reads
identically in every UI language, which is the point of using one. Only the
`System` option is translated.

| Code | Endonym |
| --- | --- |
| `en` | English |
| `ru` | Русский |
| `el` | Ελληνικά |
