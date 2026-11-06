/*
 * FullCalendar v7's shadcn block (`@fullcalendar/breezy-event-calendar`),
 * copied in from its registry like every `ui/` primitive — we own and edit
 * it. Used by the HR calendar only (PAC-169): see the exception in
 * `packages/web/CLAUDE.md`. Its three siblings are `event-calendar-toolbar`,
 * `event-calendar-icons` and `ui/event-calendar-views` (the theme).
 */
import { type CalendarOptions, useCalendarController } from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/react/daygrid'
import interactionPlugin from '@fullcalendar/react/interaction'
import listPlugin from '@fullcalendar/react/list'
import timeGridPlugin from '@fullcalendar/react/timegrid'
import { EventCalendarToolbar } from '@/components/event-calendar-toolbar'
import { EventCalendarViews } from '@/components/ui/event-calendar-views'
import { EventCalendarCloseIcon } from '@/components/event-calendar-icons'
import { cn } from '@/lib/utils'

// The free standard plugins only (`packages/web/CLAUDE.md`): day grid, time
// grid, list, interaction. The registry's block also loads multi-month; it is
// not on that list and nothing here shows a year, so it is left out.
const plugins = [
  dayGridPlugin,
  timeGridPlugin,
  listPlugin,
  interactionPlugin,
]
const defaultAvailableViews = [
  'dayGridMonth',
  'timeGridWeek',
  'timeGridDay',
  'listWeek',
]
const navLinkDayClick = 'timeGridDay'
const navLinkWeekClick = 'timeGridWeek'

export interface EventCalendarProps extends Omit<CalendarOptions, 'class' | 'className' | 'headerToolbar' | 'footerToolbar'> {
  className?: string
  availableViews?: string[]
  addButton?: {
    isPrimary?: boolean
    text?: string
    hint?: string
    click?: (ev: MouseEvent) => void
  }
}

export function EventCalendar({
  availableViews = defaultAvailableViews,
  addButton,
  direction,
  className,
  height,
  contentHeight,
  plugins: userPlugins = [],
  ...restOptions
}: EventCalendarProps) {
  const controller = useCalendarController()

  const isHeightAuto = height === 'auto' || contentHeight === 'auto'
  const hasBorderX = !(restOptions.borderlessX ?? restOptions.borderless)
  const hasBorderTop = !(restOptions.borderlessTop ?? restOptions.borderless)
  const hasBorderBottom = !(restOptions.borderlessBottom ?? restOptions.borderless)

  return (
    <div
      className={cn(
        className,
        'flex flex-col bg-background',
        hasBorderX && 'border-x',
        hasBorderTop && 'border-t',
        hasBorderBottom && 'border-b',
        (hasBorderTop && hasBorderX && !isHeightAuto) && 'rounded-t-md',
        (hasBorderBottom && hasBorderX && !isHeightAuto) && 'rounded-b-md',
        !isHeightAuto && 'overflow-hidden',
      )}
      style={{ height }}
      dir={direction === 'rtl' ? 'rtl' : undefined}
    >
      <EventCalendarToolbar
        className='border-b p-4 bg-sidebar text-sidebar-foreground'
        controller={controller}
        availableViews={availableViews}
        addButton={addButton}
      />
      <div className='grow min-h-0'>
        <EventCalendarViews
          controller={controller}
          height={isHeightAuto ? 'auto' : height !== undefined ? '100%' : contentHeight}
          initialView={availableViews[0]}
          navLinkDayClick={navLinkDayClick}
          navLinkWeekClick={navLinkWeekClick}
          plugins={[...plugins, ...userPlugins]}
          popoverCloseContent={() => (
            <EventCalendarCloseIcon />
          )}
          {...restOptions}
        />
      </div>
    </div>
  )
}
