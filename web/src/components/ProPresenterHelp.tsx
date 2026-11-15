import React from 'react'
import { ContextualHelp } from './ContextualHelp'

/**
 * The one ProPresenter help: same content and interaction from ProPresenter settings and from the
 * fullscreen Stage View popover. `id` only keeps the two entry points' element ids distinct.
 */
export const ProPresenterHelp: React.FC<{ id?: string; prefer?: 'below' | 'above' }> = ({ id = 'propresenter-help', prefer }) => (
  <ContextualHelp
    id={id}
    prefer={prefer}
    title="ProPresenter"
    buttonLabel="Help for ProPresenter"
    buttonTestId="propresenter-help-button"
    panelTestId="propresenter-help"
    quickSummary="Follow live lyrics and slides from your ProPresenter computer over the local network."
    topics={[
      {
        title: 'Status Indicators',
        defaultExpanded: true,
        content: (
          <div className="space-y-1">
            <p><strong className="text-emerald-400">Green:</strong> Connected and following slides.</p>
            <p><strong className="text-amber-400">Yellow:</strong> Connected, but paused or waiting for you.</p>
            <p><strong className="text-rose-400">Red:</strong> Offline or connection error.</p>
          </div>
        ),
      },
      {
        title: 'Auto Follow',
        defaultExpanded: false,
        content: <p>Follows ProPresenter through the songs of your active GTAR setlist only. It never jumps to a song outside the setlist.</p>,
      },
      {
        title: 'Manual Override',
        defaultExpanded: false,
        content: <p>Scrolling, or picking a song or section yourself, pauses following. Slide highlights stay on.</p>,
      },
      {
        title: 'Resume',
        defaultExpanded: false,
        content: <p>Tap Resume in the ProPresenter popover on Stage View to follow again.</p>,
      },
      {
        title: 'Stop',
        defaultExpanded: false,
        content: <p>Ends live lyrics for the current song. ProPresenter stays connected.</p>,
      },
      {
        title: 'Setup & Connection',
        defaultExpanded: false,
        content: <p>In Advanced Tools, open ProPresenter and enter the ProPresenter computer address. Turn on Network in ProPresenter. Remember Last Server keeps the last address that connected.</p>,
      },
    ]}
  />
)
