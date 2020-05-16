import React from 'react';

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
            dropdown = <div className="dropdown">
                <ul>
                    <li onClick={this.handleLeaveGameClicked}>
                        {this.props.isModerator ? 'End Game' : 'Leave Game'}
                    </li>
                </ul>
            </div>;
        }

        return <div className="toolbar">
            <div className="player-name">
                {this.props.playerName}{this.props.isModerator ? ' (Moderator)' : ' (Player)'}
            </div>
            <div className="dropdown-container" ref={this.dropdownContainer}>
                <div className="dropdown-toggle" onClick={this.toggleDropdown}>&#8943;</div>
                {dropdown}
            </div>
        </div>
    }
}