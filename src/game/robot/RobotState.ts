/** What a robot is doing right now; set by the running action. */
export enum RobotState {
  Idle = 'idle',
  Moving = 'moving',
  Harvesting = 'harvesting',
  Returning = 'returning',
  Depositing = 'depositing',
}
