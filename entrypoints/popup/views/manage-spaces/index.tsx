import {
  ChevronDown,
  EllipsisVertical,
  Pen,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import noSpacesImg from "@/assets/no-spaces.svg";
import checkMarkImg from "@/assets/check-mark.svg";
import { Badge } from "@/components/badge";
import { Space as ISpace, Tab, useAppStore } from "../../app-store";
import { cn } from "@/lib/utils";

export function ManageSpaces() {
  const { spaces, isLicenseValid } = useAppStore();

  const sorted = useMemo(
    () =>
      Object.entries(spaces).sort((a, b) => a[1].createdAt - b[1].createdAt),
    [spaces]
  );

  return (
    <ScrollArea className="max-h-[500px] flex flex-col">
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
}: {
  spaceId: string;
  space: ISpace;
  disabled: boolean;
}) {
  const { updateSpace, deleteSpace, activeSpaces } = useAppStore();
  const [currentWindow, setCurrentWindow] = useState<number | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [value, setValue] = useState(space.name);
  const totalTabs = space.tabs
    .map((tab) => (typeof tab === "string" ? tab : Object.values(tab)[0]))
    .flat().length;

  const isActive = activeSpaces[spaceId] === currentWindow;

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
      className={cn(
        "flex items-center justify-between space-x-2 p-2 text-base hover:bg-gray-50 rounded-md",
        disabled && "opacity-75"
      )}
      onClick={handleClick}
    >
      <div
        className={cn(
          "flex items-center space-x-2",
          !disabled && "cursor-pointer"
        )}
      >
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
        ? await parseTabsForSpace(currentWindow.id)
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
