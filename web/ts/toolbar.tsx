import React from 'react';
import { JeopardyContext } from './common';

interface ToolbarProps {
    playerName: string,
    isModerator: boolean,
    leaveGameCallback: () => void,
    endGameCallback: () => void,
}
interface ToolbarState {
    dropdownOpen: boolean,
}
export class Toolbar extends React.Component<ToolbarProps, ToolbarState> {
    declare context: React.ContextType<typeof JeopardyContext>;
    static contextType = JeopardyContext;

    constructor(props: ToolbarProps) {
        super(props);

        this.handleLeaveGameClicked = this.handleLeaveGameClicked.bind(this);
        this.toggleDropdown = this.toggleDropdown.bind(this);
        this.handleExternalClick = this.handleExternalClick.bind(this);
    }

    private dropdownContainer: React.RefObject<HTMLDivElement> = React.createRef();

    state = {
        dropdownOpen: false,
    }

    handleLeaveGameClicked() {
        this.setState({
            dropdownOpen: false,
        });

        if (this.props.isModerator) {
            this.props.endGameCallback();
        } else {
            this.props.leaveGameCallback();
        }
    }

    toggleDropdown() {
        this.setState({
            dropdownOpen: !this.state.dropdownOpen,
        });
    }

    handleExternalClick(e: MouseEvent) {
        if (this.dropdownContainer.current !== null) {
            if (!this.dropdownContainer.current.contains(e.target as Node)) {
                this.setState({
                    dropdownOpen: false,
                });
            }
        }
    }

    componentDidMount() {
        document.addEventListener('mouseup', this.handleExternalClick);
    }

    componentWillUnmount() {
        document.removeEventListener('mouseup', this.handleExternalClick);
    }

    render() {
        let dropdown = null;
        if (this.state.dropdownOpen) {
            let text;
            if (this.props.isModerator) {
                text = 'End Game';
            } else if (this.context.joinInfo?.playerId === null) {
                text = 'Stop Spectating';
            } else {
                text = 'Leave Game';
            }

            dropdown = <div className="dropdown">
                <ul>
                    <li onClick={this.handleLeaveGameClicked}>
                        {text}
                    </li>
                </ul>
            </div>;
        }

        let suffix = '';
        if (this.props.isModerator) {
            suffix = ' (Moderator)';
        } else if (this.context.joinInfo?.playerId !== null) {
            suffix = ' (Player)';
        }

        return <div className="toolbar">
            <div className="player-name">
                {this.props.playerName + suffix}
            </div>
            <div className="dropdown-container" ref={this.dropdownContainer}>
                <div className="dropdown-toggle" onClick={this.toggleDropdown}>&#8943;</div>
                {dropdown}
            </div>
        </div>
    }
}