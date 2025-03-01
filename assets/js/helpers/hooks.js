import { useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Changes its return value whenever the value of forceReload field
 * in the location state increases.
 */
export function useShouldReload() {
    const location = useLocation();
    const forceReload = location?.state?.forceReload;
    const [oldForceReload, setOldForceReload] = useState(forceReload);

    if (oldForceReload !== forceReload) {
        setOldForceReload(forceReload);
    }

    // The location state is not persisted during navigation
    // so forceReload would change to undefined on successive navigation,
    // triggering an unwanter reload.
    // We use a separate counter to prevent that.
    const [reloadCounter, setReloadCounter] = useState(0);
    if (forceReload !== undefined && forceReload !== oldForceReload) {
        let newReloadCounter = reloadCounter + 1;

        setReloadCounter(newReloadCounter);
        return newReloadCounter;
    }

    return reloadCounter;
}
