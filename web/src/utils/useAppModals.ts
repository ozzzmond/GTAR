/**
 * #85 slice 4: App modal/drawer visibility in one reducer instead of ten separate useState calls.
 * Each entry keeps the exact `[isOpen, setIsOpen]` shape of useState (setters accept a value or an
 * updater and are stable), so every existing call site in App works unchanged.
 */
import { useMemo, useReducer, type Dispatch, type SetStateAction } from 'react'

export const APP_MODALS = [
  'websiteUrl', 'import', 'backupRestore', 'stageSettings', 'stageTools', 'theme', 'json', 'headerKeyPicker',
  'setlistDrawer', 'tvPresentation',
] as const
export type AppModal = typeof APP_MODALS[number]
export type AppModalState = Record<AppModal, boolean>
type Action = { modal: AppModal; value: SetStateAction<boolean> }

export function appModalReducer(state: AppModalState, { modal, value }: Action): AppModalState {
  const next = typeof value === 'function' ? value(state[modal]) : value
  return next === state[modal] ? state : { ...state, [modal]: next }
}

export function useAppModals(initial: () => Partial<AppModalState> = () => ({})) {
  const [state, dispatch] = useReducer(appModalReducer, undefined, (): AppModalState => ({
    ...(Object.fromEntries(APP_MODALS.map(modal => [modal, false])) as AppModalState),
    ...initial(),
  }))
  const setters = useMemo(() => Object.fromEntries(APP_MODALS.map(modal =>
    [modal, (value: SetStateAction<boolean>) => dispatch({ modal, value })])) as Record<AppModal, Dispatch<SetStateAction<boolean>>>, [])
  return useMemo(() => Object.fromEntries(APP_MODALS.map(modal => [modal, [state[modal], setters[modal]] as const])) as
    { [K in AppModal]: readonly [boolean, Dispatch<SetStateAction<boolean>>] }, [state, setters])
}
