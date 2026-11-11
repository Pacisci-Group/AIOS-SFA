import { CalendarController } from "@fullcalendar/react";
import {
  EventCalendarNextIcon,
  EventCalendarPrevIcon,
} from "@/components/event-calendar-icons";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface EventCalendarToolbarProps {
  className?: string;
  controller: CalendarController;
  availableViews: string[];
  addButton?: {
    isPrimary?: boolean;
    text?: string;
    hint?: string;
    click?: (ev: MouseEvent) => void;
  };
}

export function EventCalendarToolbar({
  className,
  controller,
  availableViews,
  addButton,
}: EventCalendarToolbarProps) {
  const buttons = controller.getButtonState();

  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-3", className)}
    >
      {/*
        One DOM, two layouts. On a phone: the title and the arrows share the
        first row, the view tabs and Today the second, and the add button is
        a full-width third. From `sm` up, the original order: add, Today,
        arrows, title — and the tabs on the right.
      */}
      {addButton && (
        <Button
          onClick={addButton.click as any}
          aria-label={addButton.hint}
          className="order-5 basis-full sm:order-1 sm:basis-auto"
        >
          {addButton.text}
        </Button>
      )}
      <Button
        onClick={() => controller.today()}
        aria-label={buttons.today.hint}
        variant="outline"
        className="order-4 ml-auto sm:order-2 sm:ml-0"
      >
        {buttons.today.text}
      </Button>
      <div className="order-2 flex items-center sm:order-3">
        <Button
          onClick={() => controller.prev()}
          disabled={buttons.prev.isDisabled}
          aria-label={buttons.prev.hint}
          variant="ghost"
          size="icon"
        >
          <EventCalendarPrevIcon />
        </Button>
        <Button
          onClick={() => controller.next()}
          disabled={buttons.next.isDisabled}
          aria-label={buttons.next.hint}
          variant="ghost"
          size="icon"
        >
          <EventCalendarNextIcon />
        </Button>
      </div>
      <div className="order-1 grow text-lg font-semibold tracking-tight sm:order-4 sm:grow-0">
        {controller.view?.title}
      </div>
      <Tabs
        value={controller.view?.type ?? availableViews[0]}
        className="order-3 sm:order-5 sm:ml-auto"
      >
        <TabsList>
          {availableViews.map((availableView) => (
            <TabsTrigger
              key={availableView}
              value={availableView}
              onClick={() => controller.changeView(availableView)}
              aria-label={buttons[availableView]?.hint}
            >
              {buttons[availableView]?.text}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
