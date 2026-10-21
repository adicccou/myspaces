import {
  ChevronDown,
  EllipsisVertical,
  Pen,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  AcademicCapIcon,
  BookOpenIcon,
  BriefcaseIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  CodeBracketIcon,
  ComputerDesktopIcon,
  HeartIcon,
  HomeIcon,
  LightBulbIcon,
  MusicalNoteIcon,
  PaintBrushIcon,
  PuzzlePieceIcon,
  ShoppingBagIcon,
  TrophyIcon,
} from "@heroicons/react/24/solid";
import type { ComponentType, SVGProps } from "react";
import noSpacesImg from "@/assets/no-spaces.svg";
import checkMarkImg from "@/assets/check-mark.svg";
import { Badge } from "@/components/badge";
import { Space as ISpace, Tab, useAppStore } from "../../app-store";
import { cn } from "@/lib/utils";
import { reconcileTabIds } from "@/utils/space-tabs";
import { parseTabsForSpace } from "@/utils/tab";
import {
  DEFAULT_SPACE_ICON,
  DEFAULT_SPACE_ICON_COLOR,
  SPACE_ICON_COLORS,
  type SpaceIconColor,
  type SpaceIconId,
} from "@/utils/space-icons";

const SPACE_ICONS: { id: SpaceIconId; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { id: "briefcase", label: "Work", Icon: BriefcaseIcon },
  { id: "book-open", label: "Reading", Icon: BookOpenIcon },
  { id: "graduation-cap", label: "Study", Icon: AcademicCapIcon },
  { id: "laptop", label: "Computer", Icon: ComputerDesktopIcon },
  { id: "code", label: "Development", Icon: CodeBracketIcon },
  { id: "chart", label: "Planning", Icon: ChartBarIcon },
  { id: "calendar", label: "Schedule", Icon: CalendarDaysIcon },
  { id: "lightbulb", label: "Ideas", Icon: LightBulbIcon },
  { id: "dumbbell", label: "Fitness", Icon: TrophyIcon },
  { id: "gamepad", label: "Gaming", Icon: PuzzlePieceIcon },
  { id: "palette", label: "Creative", Icon: PaintBrushIcon },
  { id: "music", label: "Music", Icon: MusicalNoteIcon },
  { id: "shopping-bag", label: "Shopping", Icon: ShoppingBagIcon },
  { id: "heart", label: "Personal", Icon: HeartIcon },
  { id: "house", label: "Home", Icon: HomeIcon },
];

export function ManageSpaces() {
  const { spaces, spaceOrder, reorderSpaces, isLicenseValid } = useAppStore();
  const [draggedSpaceId, setDraggedSpaceId] = useState<string | null>(null);
  const [dropTargetSpaceId, setDropTargetSpaceId] = useState<string | null>(null);
  useEffect(() => {
    browser.runtime.sendMessage({ type: "sync-spaces-from-database" }).catch(() => {});
  }, []);

  const sorted = useMemo(
    () =>
      Object.entries(spaces).sort((a, b) => {
        const aIndex = spaceOrder.indexOf(a[0]);
        const bIndex = spaceOrder.indexOf(b[0]);
        if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
        if (aIndex >= 0) return -1;
        if (bIndex >= 0) return 1;
        return a[1].createdAt - b[1].createdAt;
      }),
    [spaces, spaceOrder]
  );

  return (
    <ScrollArea className="flex-1 min-h-0 flex flex-col">
      {!sorted.length ? (
        <div className="min-h-[200px]  flex items-center justify-center">
          <div className="flex flex-col items-center">
            <img src={noSpacesImg} alt="Empty state" className="size-16" />
            <p className="text-gray-400 text-base mt-2">No spaces yet</p>
          </div>
        </div>
      ) : (
        <div className="min-h-[200px] flex flex-col">
          {sorted.map(([spaceId, space], i) => (
            <Space
              key={spaceId}
              space={space}
              spaceId={spaceId}
              disabled={!isLicenseValid && i >= 3}
              dragged={draggedSpaceId === spaceId}
              dropTarget={dropTargetSpaceId === spaceId && draggedSpaceId !== spaceId}
              onDragStart={() => setDraggedSpaceId(spaceId)}
              onDragOver={(event) => {
                event.preventDefault();
                setDropTargetSpaceId(spaceId);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedSpaceId) reorderSpaces(draggedSpaceId, spaceId);
                setDraggedSpaceId(null);
                setDropTargetSpaceId(null);
              }}
              onDragEnd={() => {
                setDraggedSpaceId(null);
                setDropTargetSpaceId(null);
              }}
            />
          ))}
        </div>
      )}
      <div className="sticky bottom-0 bg-background z-1">
        <AddSpace />
      </div>
    </ScrollArea>
  );
}

function Space({
  spaceId,
  space,
  disabled,
  dragged,
  dropTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  spaceId: string;
  space: ISpace;
  disabled: boolean;
  dragged: boolean;
  dropTarget: boolean;
  onDragStart: () => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const { updateSpace, deleteSpace, activeSpaces, windowSpaces } = useAppStore();
  const [currentWindow, setCurrentWindow] = useState<number | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [iconSearch, setIconSearch] = useState("");
  const [value, setValue] = useState(space.name);
  const totalTabs = space.tabs
    .map((tab) => (typeof tab === "string" ? tab : Object.values(tab)[0]))
    .flat().length;
  const selectedIcon = SPACE_ICONS.find(({ id }) => id === space.icon) ||
    SPACE_ICONS.find(({ id }) => id === DEFAULT_SPACE_ICON)!;
  const iconColor = SPACE_ICON_COLORS.find(({ id }) => id === space.iconColor) ||
    SPACE_ICON_COLORS.find(({ id }) => id === DEFAULT_SPACE_ICON_COLOR)!;
  const filteredIcons = SPACE_ICONS.filter(({ label }) =>
    label.toLowerCase().includes(iconSearch.trim().toLowerCase())
  );

  const isActive = currentWindow !== null
    ? (windowSpaces?.[currentWindow] ?? (activeSpaces[spaceId] === currentWindow ? spaceId : undefined)) === spaceId
    : false;

  useEffect(() => {
    setValue(space.name);
  }, [space.name]);

  useEffect(() => {
    browser.windows
      .getCurrent()
      .then((currWin) => setCurrentWindow(currWin?.id || null));
  }, []);

  if (renameOpen)
    return (
      <div className="flex items-center space-x-2 p-2 text-base">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          className="flex-1"
        />
        <Button
          onClick={() => {
            updateSpace(spaceId, { name: value });
            setRenameOpen(false);
          }}
        >
          Change
        </Button>
      </div>
    );

  const handleClick = async () => {
    if (disabled) return;
    browser.runtime.sendMessage({
      type: "switch-space",
      spaceId,
      windowId: (await browser.windows.getCurrent()).id,
    });
  };

  return (
    <div
      draggable={!disabled && !renameOpen}
      className={cn(
        "flex items-center justify-between space-x-2 p-2 text-base hover:bg-gray-100 rounded-md transition-colors",
        !disabled && "cursor-grab active:cursor-grabbing",
        disabled && "opacity-75",
        dragged && "opacity-40",
        dropTarget && "bg-gray-100 ring-1 ring-inset ring-primary/30"
      )}
      onClick={handleClick}
      onDragStart={(event) => {
        if ((event.target as HTMLElement).closest("button, input")) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", spaceId);
        onDragStart();
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div
        className={cn(
          "flex min-w-0 items-center space-x-2",
          !disabled && "cursor-pointer"
        )}
      >
        <DropdownMenu onOpenChange={(open) => !open && setIconSearch("")}>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Choose icon for ${space.name}`}
              title="Choose Space icon"
              className="size-9 shrink-0 rounded-md"
              onClick={(event) => event.stopPropagation()}
            >
              <selectedIcon.Icon className="size-[22px]" style={{ color: iconColor.value }} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="start"
            className="w-[280px] p-3"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== "Escape") event.stopPropagation();
            }}
          >
            <div className="mb-3 flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={iconSearch}
                  onChange={(event) => setIconSearch(event.target.value)}
                  placeholder="Search icons"
                  aria-label="Search Space icons"
                  className="h-9 pl-8"
                />
              </div>
              {iconSearch && (
                <Button variant="ghost" size="sm" onClick={() => setIconSearch("")}>Clear</Button>
              )}
            </div>
            <div className="mb-3 flex items-center justify-between" aria-label="Icon color">
              {SPACE_ICON_COLORS.map((color) => (
                <button
                  key={color.id}
                  type="button"
                  aria-label={`${color.label} icon color`}
                  aria-pressed={iconColor.id === color.id}
                  title={color.label}
                  className={cn(
                    "size-7 rounded-full transition-transform hover:scale-110",
                    iconColor.id === color.id && "ring-2 ring-offset-2 ring-muted-foreground"
                  )}
                  style={{ backgroundColor: color.value }}
                  onClick={() => updateSpace(spaceId, { iconColor: color.id as SpaceIconColor })}
                />
              ))}
            </div>
            <div className="grid grid-cols-5 gap-1" role="group" aria-label="Space icons">
              {filteredIcons.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-label={`${label} icon`}
                  aria-pressed={(space.icon || DEFAULT_SPACE_ICON) === id}
                  title={label}
                  className={cn(
                    "flex size-11 items-center justify-center rounded-lg transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    (space.icon || DEFAULT_SPACE_ICON) === id && "ring-1 ring-inset ring-border"
                  )}
                  onClick={() => updateSpace(spaceId, { icon: id })}
                >
                  <Icon className="size-6" style={{ color: iconColor.value }} />
                </button>
              ))}
            </div>
            {!filteredIcons.length && (
              <p className="py-3 text-center text-sm text-muted-foreground">No icons found</p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <span
          className={cn(
            "truncate max-w-48",
            disabled && "text-muted-foreground"
          )}
        >
          {space.name}
        </span>
        <Badge variant="secondary" className="text-gray-500">
          {totalTabs} tabs
        </Badge>
      </div>
      <div className="flex items-center space-x-2">
        {isActive && (
          <img
            src={checkMarkImg}
            alt="Active"
            className="w-5 h-5"
            title="This space is active"
          />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <Button
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end">
            <DropdownMenuItem onClick={() => setRenameOpen(true)}>
              <Pen /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => deleteSpace(spaceId)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function AddSpace() {
  const addSpace = useAppStore((state) => state.addSpace);
  const spaces = useAppStore((state) => state.spaces);
  const setView = useAppStore((state) => state.setView);
  const isLicenseValid = useAppStore((state) => state.isLicenseValid);
  const [open, setOpen] = useState(false);
  const [spaceName, setSpaceName] = useState("New space");

  const handleAddSpace = async (name: string, withTabs: boolean) => {
    if (!isLicenseValid && Object.keys(spaces).length >= 3) {
      setView("settings");
      return;
    }

    const currentWindow = await browser.windows.getCurrent();

    const spaceId = crypto.randomUUID();
    await addSpace(spaceId, {
      name,
      tabs: withTabs
          ? reconcileTabIds([], await parseTabsForSpace(currentWindow.id))
        : [
            {
              url: "chrome://newtab/",
              active: true,
              groupId: "-1",
              pinned: false,
            },
          ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    browser.runtime.sendMessage({
      type: "switch-space",
      spaceId,
    });
  };

  const handleClose = () => {
    setOpen(false);
    setSpaceName("New space");
  };

  return (
    <div className="p-2 border-t">
      {open ? (
        <div className="w-full flex space-x-2">
          <Button variant="ghost" onClick={handleClose}>
            <X />
          </Button>
          <Input
            placeholder="Space name"
            autoFocus
            value={spaceName}
            onChange={(e) => setSpaceName(e.target.value)}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={!spaceName}>
              <Button>
                Add space <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => {
                  handleAddSpace(spaceName, false);
                  handleClose();
                }}
              >
                New empty Space
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  handleAddSpace(spaceName, true);
                  handleClose();
                }}
              >
                New space with Open Tabs
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setOpen(true)}>
          <Plus /> Add space
        </Button>
      )}
    </div>
  );
}
