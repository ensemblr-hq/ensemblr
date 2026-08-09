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
| Workspace | Рабочая область | Χώρος εργασίας | The isolated per-task copy of a repo. Never "проект"/"έργο" — that is `project`. |
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
| Conversation | Диалог | Συνομιλία | The chat tab's thread. |
| Turn | Ход | Γύρος | One agent request/response cycle. |
| Tab | Вкладка | Καρτέλα | |
| Dock | Док | Dock | The bottom panel strip. |
| Panel | Панель | Πίνακας | |
| Terminal | Терминал | Τερματικό | |
| Run script | Скрипт запуска | Σενάριο εκτέλεσης | Configured per repository, by name. |
| Setup script | Скрипт настройки | Σενάριο εγκατάστασης | |
| Spawn terminal | Дополнительный терминал | Πρόσθετο τερματικό | Literally "spawn" reads as biology in both; use "additional". |
| Plan mode | Режим плана | Λειτουργία σχεδίου | |
| Board | Доска | Πίνακας εργασιών | The kanban dashboard. |
| Setting | Настройка | Ρύθμιση | |
| Model | Модель | Μοντέλο | |
| Thinking level | Уровень размышления | Επίπεδο σκέψης | |
| Context usage | Использование контекста | Χρήση περιβάλλοντος | |
| Issue | Задача | Ζήτημα | Linear issue. |
| Tool call | Вызов инструмента | Κλήση εργαλείου | |
| Attachment | Вложение | Συνημμένο | |
| Token | Токен | Διακριτικό | Model context unit. Localized in both — it is not git porcelain and not a proper noun. |
| Remote | Удалённый | Απομακρυσμένο | The adjective is localized; the remote's *name* (`origin`) is not. |
| Merged | Выполнен merge | Έγινε merge | Past-tense PR status. `merge` stays borrowed per the git-porcelain rule; only the auxiliary is localized. |

## Core verbs

| English | Русский | Ελληνικά | Note |
| --- | --- | --- | --- |
| Steer | Направить | Καθοδήγηση | Interrupting an agent mid-turn. |
| Follow-up | Дополнение | Συμπλήρωμα | The queued/steering message. |
| Queue | В очередь | Σε ουρά | |
| Archive | Архивировать | Αρχειοθέτηση | |
| Discard | Отменить изменения | Απόρριψη | Destructive; never plain "Отменить" (= Undo). |
| Undo | Отменить | Αναίρεση | |
| Restore | Восстановить | Επαναφορά | |
| Resume | Продолжить | Συνέχιση | |
| Retry | Повторить | Επανάληψη | |
| Stop | Остановить | Διακοπή | |
| Approve | Разрешить | Έγκριση | Tool approval. |
| Deny | Отклонить | Άρνηση | |
| Spawn | Запустить | Εκκίνηση | Starting a sub-agent. |
| Clone | Клонировать | Κλωνοποίηση | |
| Push | Push | Push | Git; untranslated. |
| Merge | Merge | Merge | Git; untranslated. |

## Settings-page section names

| English | Русский | Ελληνικά |
| --- | --- | --- |
| General | Основные | Γενικά |
| Appearance | Внешний вид | Εμφάνιση |
| Models | Модели | Μοντέλα |
| Git | Git | Git |
| Advanced | Дополнительно | Για προχωρημένους |
| Experimental | Экспериментальные | Πειραματικά |
| Environment | Окружение | Περιβάλλον |

## Language names

Shown **untranslated** wherever the user picks a language — an endonym reads
identically in every UI language, which is the point of using one. Only the
`System` option is translated.

| Code | Endonym |
| --- | --- |
| `en` | English |
| `ru` | Русский |
| `el` | Ελληνικά |
