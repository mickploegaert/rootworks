import { TUTORIAL } from '../world/WorldGenerator.ts';
import type { LanguageId } from './types.ts';

export interface Example {
  id: string;
  title: string;
  /** Firmware tier the example needs in Guided mode (its syntax and functions). */
  tier: number;
  code: string;
}

const FIRST_PROGRAM = `# ROOTWORKS: your first program
# Press Run and watch the robot carry out each line, in order.

# 1. Move: step one tile north (up-right on the screen).
move("north")

# 2. Harvest the scrap pile that is now in front of the robot.
harvest()

# 3. Walk to the storage depot...
move_to_storage()

# 4. ...and unload the cargo.
deposit()

print("Delivered! Check the storage bar at the top.")
`;

export const PYTHON_EXAMPLES: readonly Example[] = [
  { id: 'first', title: 'Lesson 1: first steps', tier: 0, code: FIRST_PROGRAM },
  {
    id: 'kit', title: 'Lesson 2: craft and research', tier: 0, code: `# Lesson 2: craft and research
# Needs a Workbench and a Research Lab (build them from the Build menu),
# and a research project picked in the Research panel.

# Collect timber and scrap first (harvest them, or take them from storage).
go_to("storage")
take("wood", 2)
take("scrap", 1)

# The Workbench turns 2 timber + 1 scrap into a research kit.
go_to("workbench")
put()               # put in everything the recipe uses
take("research_kit")  # waits until the kit is finished

# The Lab turns kits into research.
go_to("lab")
put("research_kit")
`,
  },
  {
    id: 'loops', title: 'Lesson 3: loops and functions', tier: 3, code: `# Lesson 2: loops and functions
# Gather from the scrap pile until the robot is full,
# deliver the load, and repeat until the pile is empty.

def gather():
    while can_harvest() and not is_inventory_full():
        harvest()

trips = 0
while True:
    move_to(${TUTORIAL.nextToPile.x}, ${TUTORIAL.nextToPile.y})          # the tile next to the pile
    if not can_harvest():
        print("The pile is empty.")
        break
    gather()
    deposit()
    trips += 1
    print(f"Trip {trips} done.")
`,
  },
  {
    id: 'explore', title: 'Lesson 4: for loops and conditions', tier: 3, code: `# Lesson 3: for loops and conditions
# Walk a square and report what is next to the robot at each corner.

for direction in ["east", "south", "west", "north"]:
    for step in range(3):
        if not move(direction):
            print("Blocked going", direction)
            break
    x, y = get_position()
    kind = get_resource_type()
    if kind is None:
        print(f"({x}, {y}): nothing to harvest here")
    else:
        print(f"({x}, {y}): found {kind}!")
`,
  },
];

export const STARTER_CODE: Readonly<Record<LanguageId, string>> = {
  python: FIRST_PROGRAM,
  java: `// Java support is still being built: this program can't run yet.
// It shows how the same robot commands will look in Java.
public class Program {
    public static void main(String[] args) {
        move("north");
        harvest();
        moveToStorage();
        deposit();
    }
}
`,
  typescript: `// TypeScript support is still being built: this program can't run yet.
// It shows how the same robot commands will look in TypeScript.
move("north");
harvest();
moveToStorage();
deposit();
`,
};
