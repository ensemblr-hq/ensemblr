import { contextBridge } from 'electron';

import { createEnsembleApi } from './bridge';

contextBridge.exposeInMainWorld('ensemble', createEnsembleApi());
